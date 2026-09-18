import p5 from "p5";
import JSZip from "jszip";

const STORAGE = {
  settings: "generative-thoughts.settings.v1",
  entries: "generative-thoughts.entries.v1",
  draft: "generative-thoughts.draft.v2",
  apiBase: "generative-thoughts.api-base.v1",
};

const PALETTES = {
  phosphor: { background: "#050805", foreground: "#b8ffad", dim: "#4f8052", bright: "#f4fff1" },
  amber: { background: "#100a02", foreground: "#ffbd63", dim: "#8f5a25", bright: "#fff2d6" },
  mono: { background: "#f2f2ec", foreground: "#101310", dim: "#777b76", bright: "#000000" },
};

const state = {
  settings: loadJSON(STORAGE.settings, null),
  entries: loadJSON(STORAGE.entries, []).map(migrateEntry),
  currentId: null,
  title: "",
  text: "",
  pattern: "wave",
  palette: "phosphor",
  visualSeed: 1,
  mlVector: null,
  mlPipeline: null,
  mlStatus: "LEXICAL",
  slides: [],
  slideIndex: 0,
  saveTimer: null,
  p5: null,
  passphrase: "",
  apiBase: localStorage.getItem(STORAGE.apiBase) || "",
  instagramConnected: false,
};

const elements = Object.fromEntries(
  [
    "app", "lockScreen", "lockForm", "lockCopy", "passcode", "unlockButton", "lockError", "lockButton",
    "titleInput", "thoughtInput", "thoughtNumber", "binaryNumber", "characterCount", "wordCount", "patternSelect",
    "paletteSelect", "signalReadout", "modelButton", "saveButton", "randomizeButton", "newButton", "savedState",
    "archiveCount", "archiveList", "previewCanvas", "canvasPlaceholder", "slideType", "slideCount", "sequence",
    "sequenceStatus", "previousSlide", "nextSlide", "downloadCurrent", "downloadAll", "publishButton", "exportNote",
    "resetPasscode", "instagramSettings", "instagramDialog", "instagramAccount", "instagramBackend", "apiBaseInput",
    "captionInput", "saveInstagramSettings", "confirmPublish", "instagramMessage", "toast",
  ].map((id) => [id, document.querySelector(`#${id}`)])
);

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function migrateEntry(entry) {
  const patternMap = { orbit: "wave", weave: "attractor", signal: "cellular" };
  const paletteMap = { ink: "mono", blue: "phosphor", acid: "amber" };
  return {
    ...entry,
    title: entry.title || `Untitled ${pad(entry.index || 0)}`,
    pattern: patternMap[entry.pattern] || entry.pattern || "wave",
    palette: paletteMap[entry.palette] || entry.palette || "phosphor",
    mlVector: entry.mlVector || null,
    mlStatus: entry.mlStatus || (entry.mlVector ? "MINILM" : "LEXICAL"),
  };
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function pad(number, size = 3) {
  return String(number).padStart(size, "0");
}

function toBinary(number) {
  return Math.max(0, number - 1).toString(2);
}

function activeNumber() {
  return state.entries.find((entry) => entry.id === state.currentId)?.index ?? state.settings?.nextIndex ?? 1;
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPasscode(passcode, salt) {
  const data = new TextEncoder().encode(`${salt}:${passcode}`);
  return bufferToHex(await crypto.subtle.digest("SHA-256", data));
}

function setLockMode() {
  const returning = Boolean(state.settings?.passcodeHash);
  elements.lockCopy.textContent = returning
    ? "Enter the passphrase stored for this local index."
    : "Create a local passphrase. Writing remains on this device.";
  elements.unlockButton.textContent = returning ? "UNLOCK INDEX" : "SET PASSPHRASE";
  elements.passcode.autocomplete = returning ? "current-password" : "new-password";
  elements.lockError.textContent = "";
}

async function handleLockSubmit(event) {
  event.preventDefault();
  const passphrase = elements.passcode.value;
  if (passphrase.length < 4) {
    elements.lockError.textContent = "ERR / MINIMUM 4 CHARACTERS";
    return;
  }

  if (!state.settings?.passcodeHash) {
    const salt = randomHex();
    state.settings = { passcodeHash: await hashPasscode(passphrase, salt), salt, nextIndex: 1 };
    saveJSON(STORAGE.settings, state.settings);
  } else if ((await hashPasscode(passphrase, state.settings.salt)) !== state.settings.passcodeHash) {
    elements.lockError.textContent = "ERR / PASSPHRASE MISMATCH";
    elements.passcode.select();
    return;
  }

  state.passphrase = passphrase;
  elements.passcode.value = "";
  elements.lockScreen.hidden = true;
  elements.app.hidden = false;
  restoreDraft();
  refreshAll();
  checkInstagramStatus();
  elements.titleInput.focus();
}

function lockStudio() {
  state.passphrase = "";
  elements.app.hidden = true;
  elements.lockScreen.hidden = false;
  setLockMode();
  elements.passcode.focus();
}

function stringSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function analyzeText(text) {
  const words = text.trim().match(/\S+/g) || [];
  const punctuation = (text.match(/[.,!?;:—–-]/g) || []).length;
  const lineBreaks = (text.match(/\n/g) || []).length;
  const repeated = new Set(words.map((word) => word.toLowerCase())).size;
  const averageWord = words.length ? words.reduce((sum, word) => sum + word.length, 0) / words.length : 0;
  const lexicalDensity = words.length ? repeated / words.length : 0;
  const semantic = state.mlVector || [];
  return {
    length: text.length,
    words: words.length,
    punctuation,
    lineBreaks,
    averageWord,
    lexicalDensity,
    cadence: words.length ? Math.min(1, (punctuation + lineBreaks * 2) / words.length) : 0,
    semantic: [semantic[0] || lexicalDensity - 0.5, semantic[1] || averageWord / 12 - 0.5, semantic[2] || punctuation / 30, semantic[3] || lineBreaks / 12],
  };
}

function splitTextExactly(text, maximumSlides = 7) {
  if (!text) return [""];
  const chunks = [];
  let cursor = 0;

  while (cursor < text.length && chunks.length < maximumSlides - 1) {
    const remainingSlides = maximumSlides - chunks.length;
    const remainingLength = text.length - cursor;
    if (remainingLength <= 520) break;
    const ideal = cursor + Math.ceil(remainingLength / remainingSlides);
    const minimum = Math.min(text.length, ideal + 220);
    let breakAt = -1;
    for (let index = ideal; index <= minimum; index += 1) {
      if (/\s/.test(text[index] || "")) {
        breakAt = index + 1;
        break;
      }
    }
    if (breakAt < 0) {
      for (let index = ideal; index > cursor; index -= 1) {
        if (/\s/.test(text[index] || "")) {
          breakAt = index + 1;
          break;
        }
      }
    }
    if (breakAt <= cursor) breakAt = Math.min(text.length, ideal);
    chunks.push(text.slice(cursor, breakAt));
    cursor = breakAt;
  }
  chunks.push(text.slice(cursor));
  return chunks;
}

function buildSlides() {
  const textSlides = splitTextExactly(state.text).map((content, index) => ({ type: "text", content, textIndex: index }));
  const slides = [{ type: "cover" }];
  const shouldInterrupt = textSlides.length > 1 && stringSeed(`${state.text}|${state.visualSeed}`) % 3 !== 0;
  const interruptionPoint = Math.max(1, Math.ceil(textSlides.length / 2));
  textSlides.forEach((slide, index) => {
    slides.push(slide);
    if (shouldInterrupt && index + 1 === interruptionPoint) slides.push({ type: "pattern" });
  });
  slides.push({ type: "signal" });
  state.slides = slides.slice(0, 10);
  state.slideIndex = Math.min(state.slideIndex, state.slides.length - 1);
}

function currentFeatures() {
  return analyzeText(`${state.title}\n${state.text}`);
}

function fieldCharacter(column, row, phase, features, randomSeed) {
  const charset = " .,:;-=+*#%@";
  const sem = features.semantic;
  let value;
  if (state.pattern === "attractor") {
    const x = (column - 22) / 10;
    const y = (row - 28) / 12;
    const radius = Math.sqrt(x * x + y * y);
    const angle = Math.atan2(y, x);
    value = Math.sin(radius * (4.2 + features.averageWord * 0.13) - phase * 1.4)
      + Math.cos(angle * (3 + Math.round(features.cadence * 5)) + phase)
      + Math.sin((x * y + sem[0] * 4) * 1.7);
  } else if (state.pattern === "cellular") {
    const generation = Math.floor(phase * (2 + features.cadence * 4));
    const cell = stringSeed(`${randomSeed}:${column}:${row}:${generation >> 1}`);
    const neighbor = stringSeed(`${randomSeed}:${column - 1}:${row + generation}:${features.punctuation}`);
    value = ((cell ^ neighbor) % 1000) / 180 - 2.7 + Math.sin(row * 0.2 + phase);
  } else {
    const xFrequency = 0.13 + features.averageWord * 0.006 + Math.abs(sem[0]) * 0.08;
    const yFrequency = 0.08 + features.cadence * 0.22 + Math.abs(sem[1]) * 0.07;
    value = Math.sin(column * xFrequency + phase * (0.7 + features.lexicalDensity))
      + Math.cos(row * yFrequency - phase * (0.45 + features.cadence))
      + Math.sin((column + row) * (0.045 + Math.abs(sem[2]) * 0.04) + sem[3] * 7);
  }
  const normalized = Math.max(0, Math.min(charset.length - 1, Math.floor(((value + 3) / 6) * charset.length)));
  return charset[normalized];
}

function drawAsciiField(graphics, phase, opacity = 1) {
  const palette = PALETTES[state.palette];
  const features = currentFeatures();
  const seed = stringSeed(`${state.title}|${state.text}|${state.visualSeed}|${state.mlVector?.slice(0, 8).join(":") || "lex"}`);
  const columns = 45;
  const rows = 57;
  const cellWidth = 1080 / columns;
  const cellHeight = 1350 / rows;
  graphics.push();
  graphics.textFont("Courier New");
  graphics.textSize(22);
  graphics.textStyle(graphics.NORMAL);
  graphics.textAlign(graphics.CENTER, graphics.CENTER);
  graphics.noStroke();
  graphics.fill(withAlpha(palette.foreground, opacity));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const character = fieldCharacter(column, row, phase, features, seed);
      if (character !== " ") graphics.text(character, column * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2);
    }
  }
  graphics.pop();
}

function withAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  return `rgba(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}, ${alpha})`;
}

function drawRules(graphics, palette) {
  graphics.stroke(palette.dim);
  graphics.strokeWeight(2);
  graphics.line(64, 112, 1016, 112);
  graphics.line(64, 1238, 1016, 1238);
  graphics.noStroke();
}

function drawIndexHeader(graphics, palette, left, right) {
  graphics.fill(palette.foreground);
  graphics.textFont("Courier New");
  graphics.textStyle(graphics.NORMAL);
  graphics.textSize(25);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
  graphics.text(left, 64, 82);
  graphics.textAlign(graphics.RIGHT, graphics.BASELINE);
  graphics.text(right, 1016, 82);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
}

function wrapMonospace(graphics, text, maxWidth) {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const lines = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) lines.push("");
    else {
      let line = words.shift();
      for (const word of words) {
        if (graphics.textWidth(`${line} ${word}`) <= maxWidth) line += ` ${word}`;
        else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    if (paragraphIndex < paragraphs.length - 1) lines.push("");
  });
  return lines;
}

function fitIndexedText(graphics, text) {
  let size = 50;
  let lines = [];
  while (size >= 31) {
    graphics.textFont("Courier New");
    graphics.textStyle(graphics.NORMAL);
    graphics.textSize(size);
    lines = wrapMonospace(graphics, text.trim(), 850);
    if (lines.length * size * 1.45 <= 840) break;
    size -= 2;
  }
  return { size, lines, lineHeight: size * 1.45 };
}

function binarySignature() {
  if (state.mlVector?.length) return state.mlVector.slice(0, 64).map((value) => (value >= 0 ? "1" : "0")).join("");
  const seed = stringSeed(`${state.title}|${state.text}`);
  return Array.from({ length: 64 }, (_, index) => ((seed >>> (index % 32)) & 1 ? "1" : "0")).join("");
}

function drawCover(graphics, phase, palette) {
  drawAsciiField(graphics, phase, 0.95);
  graphics.noStroke();
  graphics.fill(withAlpha(palette.background, 0.84));
  graphics.rect(54, 760, 972, 500);
  drawRules(graphics, palette);
  drawIndexHeader(graphics, palette, `GENERATIVE_THOUGHTS / INDEX_${pad(activeNumber())}`, `BINARY_${toBinary(activeNumber())}`);
  graphics.fill(palette.bright);
  graphics.textFont("Courier New");
  graphics.textAlign(graphics.LEFT, graphics.TOP);
  graphics.textStyle(graphics.NORMAL);
  graphics.textSize(92);
  graphics.text(toBinary(activeNumber()), 74, 798, 900, 160);
  graphics.textSize(48);
  graphics.text((state.title || "UNTITLED").toUpperCase(), 74, 990, 880, 150);
  graphics.fill(palette.foreground);
  graphics.textSize(22);
  graphics.text(`TEXT_SEED_${stringSeed(state.text).toString(16).toUpperCase().padStart(8, "0")}`, 74, 1192);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
}

function drawTextSlide(graphics, slide, index, phase, palette) {
  drawAsciiField(graphics, phase * 0.15, 0.12);
  graphics.noStroke();
  graphics.fill(withAlpha(palette.background, 0.93));
  graphics.rect(42, 40, 996, 1270);
  drawRules(graphics, palette);
  drawIndexHeader(graphics, palette, `INDEX_${pad(activeNumber())} / TEXT_${pad(slide.textIndex + 1, 2)}`, `PAGE_${(index + 1).toString(2)}`);
  const fitted = fitIndexedText(graphics, slide.content);
  let y = 218;
  graphics.fill(palette.bright);
  graphics.textFont("Courier New");
  graphics.textStyle(graphics.NORMAL);
  graphics.textSize(fitted.size);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
  fitted.lines.forEach((line, lineIndex) => {
    graphics.fill(palette.dim);
    graphics.text(pad(lineIndex + 1, 2), 64, y);
    graphics.fill(palette.bright);
    if (line) graphics.text(line, 140, y);
    y += fitted.lineHeight;
  });
  graphics.fill(palette.foreground);
  graphics.textSize(21);
  graphics.text(`${(state.title || "UNTITLED").toUpperCase()} / TEXT_PRESERVED`, 64, 1287);
}

function drawPatternSlide(graphics, phase, palette) {
  drawAsciiField(graphics, phase * 1.3, 1);
  drawRules(graphics, palette);
  drawIndexHeader(graphics, palette, `INDEX_${pad(activeNumber())} / INTERRUPTION`, `SEED_${state.visualSeed.toString(16).slice(-6).toUpperCase()}`);
  graphics.fill(withAlpha(palette.background, 0.8));
  graphics.noStroke();
  graphics.rect(64, 1155, 952, 83);
  graphics.fill(palette.foreground);
  graphics.textFont("Courier New");
  graphics.textSize(22);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
  graphics.text("[ PATTERN_ONLY / TEXT_SIGNAL_CONTINUES ]", 78, 1205);
}

function drawSignalSlide(graphics, phase, palette) {
  drawAsciiField(graphics, phase * 0.55, 0.28);
  graphics.fill(withAlpha(palette.background, 0.9));
  graphics.noStroke();
  graphics.rect(46, 44, 988, 1260);
  drawRules(graphics, palette);
  drawIndexHeader(graphics, palette, `INDEX_${pad(activeNumber())} / LOCAL_SIGNAL`, state.mlVector ? "MODEL_MINILM" : "MODEL_LEXICAL");
  const features = currentFeatures();
  const rows = [
    ["SOURCE_LENGTH", String(features.length)],
    ["WORD_COUNT", String(features.words)],
    ["PUNCTUATION", String(features.punctuation)],
    ["AVG_WORD", features.averageWord.toFixed(3)],
    ["CADENCE", features.cadence.toFixed(5)],
    ["LEXICAL_DENSITY", features.lexicalDensity.toFixed(5)],
    ["FIELD_EQUATION", state.pattern.toUpperCase()],
    ["SEMANTIC_SOURCE", state.mlVector ? "LOCAL_TRANSFORMER" : "LOCAL_LEXICAL"],
  ];
  graphics.textFont("Courier New");
  graphics.textStyle(graphics.NORMAL);
  graphics.textSize(28);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
  rows.forEach(([label, value], index) => {
    const y = 210 + index * 74;
    graphics.fill(palette.dim);
    graphics.text(label, 72, y);
    graphics.fill(palette.bright);
    graphics.text(value, 530, y);
    graphics.stroke(palette.dim);
    graphics.strokeWeight(1);
    graphics.line(72, y + 22, 1008, y + 22);
    graphics.noStroke();
  });
  graphics.fill(palette.foreground);
  graphics.textSize(31);
  const signature = binarySignature();
  graphics.text(signature.slice(0, 32), 72, 915);
  graphics.text(signature.slice(32), 72, 966);
  graphics.fill(palette.dim);
  graphics.textSize(20);
  graphics.text("SEMANTIC_SIGNATURE / TEXT NOT REWRITTEN", 72, 1028);
  graphics.fill(palette.bright);
  graphics.textSize(38);
  graphics.text("THE TEXT REMAINS THE SOURCE.", 72, 1135);
}

function drawSlide(index, graphics = state.p5, phase = 0) {
  if (!graphics || !state.slides.length) return;
  const slide = state.slides[index];
  const palette = PALETTES[state.palette];
  graphics.background(palette.background);
  if (slide.type === "cover") drawCover(graphics, phase, palette);
  else if (slide.type === "text") drawTextSlide(graphics, slide, index, phase, palette);
  else if (slide.type === "pattern") drawPatternSlide(graphics, phase, palette);
  else drawSignalSlide(graphics, phase, palette);
}

function renderSequence() {
  elements.slideCount.textContent = `${pad(state.slideIndex + 1, 2)}/${pad(state.slides.length, 2)}`;
  elements.slideType.textContent = state.slides[state.slideIndex]?.type.toUpperCase() || "COVER";
  elements.sequenceStatus.textContent = state.slides.map((slide) => slide.type.toUpperCase()).join(" → ");
  elements.sequence.innerHTML = state.slides.map((slide, index) => `
    <button type="button" data-slide-index="${index}" class="${index === state.slideIndex ? "is-active" : ""}">
      ${pad(index + 1, 2)}<span>${slide.type.toUpperCase()}</span>
    </button>`).join("");
  elements.previousSlide.disabled = state.slideIndex === 0;
  elements.nextSlide.disabled = state.slideIndex === state.slides.length - 1;
}

function refreshSlides() {
  buildSlides();
  elements.canvasPlaceholder.hidden = Boolean(state.text || state.title);
  drawSlide(state.slideIndex, state.p5, performance.now() / 1000);
  renderSequence();
  updateSignalReadout();
}

function updateSignalReadout() {
  const features = currentFeatures();
  elements.signalReadout.textContent = `LEN:${pad(features.length, 4)} / PUNC:${pad(features.punctuation, 3)} / CAD:${features.cadence.toFixed(3)} / SEM:${state.mlStatus}`;
  elements.characterCount.textContent = state.text.length.toLocaleString();
  elements.wordCount.textContent = features.words.toLocaleString();
}

function persistDraft() {
  saveJSON(STORAGE.draft, {
    id: state.currentId,
    title: state.title,
    text: state.text,
    pattern: state.pattern,
    palette: state.palette,
    visualSeed: state.visualSeed,
    mlVector: state.mlVector,
    mlStatus: state.mlStatus,
  });
  elements.savedState.textContent = "LOCAL/SAVED";
}

function queueDraftSave() {
  elements.savedState.textContent = "LOCAL/WRITING";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(persistDraft, 250);
}

function restoreDraft() {
  const draft = loadJSON(STORAGE.draft, null);
  if (!draft) return;
  Object.assign(state, {
    currentId: draft.id ?? null,
    title: draft.title ?? "",
    text: draft.text ?? "",
    pattern: draft.pattern ?? "wave",
    palette: draft.palette ?? "phosphor",
    visualSeed: draft.visualSeed ?? 1,
    mlVector: draft.mlVector ?? null,
    mlStatus: draft.mlStatus ?? (draft.mlVector ? "MINILM" : "LEXICAL"),
  });
}

function refreshAll() {
  elements.titleInput.value = state.title;
  elements.thoughtInput.value = state.text;
  elements.patternSelect.value = state.pattern;
  elements.paletteSelect.value = state.palette;
  elements.thoughtNumber.textContent = pad(activeNumber());
  elements.binaryNumber.textContent = toBinary(activeNumber());
  elements.modelButton.textContent = state.mlVector ? "RE-RUN LOCAL MODEL" : "RUN LOCAL MODEL";
  renderArchive();
  refreshSlides();
}

function saveThought() {
  if (!state.text.trim()) return showToast("ERR / TEXT_REQUIRED");
  const now = new Date().toISOString();
  const existingIndex = state.entries.findIndex((entry) => entry.id === state.currentId);
  const values = {
    title: state.title || `Untitled ${pad(activeNumber())}`,
    text: state.text,
    pattern: state.pattern,
    palette: state.palette,
    visualSeed: state.visualSeed,
    mlVector: state.mlVector,
    mlStatus: state.mlStatus,
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    state.entries[existingIndex] = { ...state.entries[existingIndex], ...values };
    showToast(`INDEX_${pad(state.entries[existingIndex].index)} / UPDATED`);
  } else {
    const entry = { id: crypto.randomUUID(), index: state.settings.nextIndex, createdAt: now, ...values };
    state.entries.unshift(entry);
    state.currentId = entry.id;
    state.settings.nextIndex += 1;
    saveJSON(STORAGE.settings, state.settings);
    showToast(`INDEX_${pad(entry.index)} / SAVED`);
  }
  saveJSON(STORAGE.entries, state.entries);
  persistDraft();
  refreshAll();
}

function newThought() {
  Object.assign(state, {
    currentId: null,
    title: "",
    text: "",
    pattern: "wave",
    palette: "phosphor",
    visualSeed: crypto.getRandomValues(new Uint32Array(1))[0],
    mlVector: null,
    mlStatus: "LEXICAL",
    slideIndex: 0,
  });
  persistDraft();
  refreshAll();
  elements.titleInput.focus();
}

function loadEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  Object.assign(state, {
    currentId: entry.id,
    title: entry.title || "",
    text: entry.text,
    pattern: entry.pattern || "wave",
    palette: entry.palette || "phosphor",
    visualSeed: entry.visualSeed,
    mlVector: entry.mlVector || null,
    mlStatus: entry.mlStatus || (entry.mlVector ? "MINILM" : "LEXICAL"),
    slideIndex: 0,
  });
  persistDraft();
  refreshAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderArchive() {
  elements.archiveCount.textContent = pad(state.entries.length);
  if (!state.entries.length) {
    elements.archiveList.innerHTML = '<p class="archive-empty">NO_SAVED_ENTRIES</p>';
    return;
  }
  elements.archiveList.innerHTML = state.entries.map((entry) => {
    const date = new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" }).format(new Date(entry.updatedAt));
    return `<button class="archive-item" type="button" data-entry-id="${entry.id}">
      <span>${pad(entry.index)}</span><span class="archive-title">${escapeHTML(entry.title || entry.text.slice(0, 50))}</span><span class="archive-date">${date}</span>
    </button>`;
  }).join("");
}

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function runLocalModel() {
  if (!state.text.trim()) return showToast("ERR / TEXT_REQUIRED_FOR_MODEL");
  elements.modelButton.disabled = true;
  elements.modelButton.textContent = "LOADING MODEL…";
  state.mlStatus = "LOADING";
  updateSignalReadout();
  try {
    if (!state.mlPipeline) {
      const { pipeline } = await import("@huggingface/transformers");
      state.mlPipeline = await pipeline("feature-extraction", "onnx-community/all-MiniLM-L6-v2-ONNX", {
        dtype: "q4",
        progress_callback: (progress) => {
          if (progress.status === "progress" && progress.progress) {
            elements.modelButton.textContent = `MODEL ${Math.round(progress.progress)}%`;
          }
        },
      });
    }
    const result = await state.mlPipeline(`${state.title}\n${state.text}`, { pooling: "mean", normalize: true });
    state.mlVector = Array.from(result.data.slice(0, 64));
    state.mlStatus = "MINILM";
    persistDraft();
    refreshAll();
    showToast("LOCAL_SEMANTIC_SIGNAL / READY");
  } catch (error) {
    console.error(error);
    state.mlStatus = "LEXICAL";
    showToast("MODEL_UNAVAILABLE / LEXICAL_SIGNAL_RETAINED");
  } finally {
    elements.modelButton.disabled = false;
    elements.modelButton.textContent = state.mlVector ? "RE-RUN LOCAL MODEL" : "RUN LOCAL MODEL";
    updateSignalReadout();
  }
}

function randomizePattern() {
  state.visualSeed = crypto.getRandomValues(new Uint32Array(1))[0];
  state.slideIndex = 0;
  refreshSlides();
  queueDraftSave();
  showToast("FIELD_SEED_CHANGED / TEXT_UNCHANGED");
}

function canvasToBlob(canvas, quality = 0.9) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportFilename(index) {
  return `generative-thought-${pad(activeNumber())}-${pad(index + 1, 2)}-${state.slides[index].type}.jpg`;
}

async function renderExportSlide(index, graphics) {
  drawSlide(index, graphics, 0);
  return canvasToBlob(graphics.canvas, 0.9);
}

async function downloadCurrentSlide() {
  if (!state.text.trim()) return showToast("ERR / TEXT_REQUIRED");
  const graphics = state.p5.createGraphics(1080, 1350);
  graphics.pixelDensity(1);
  const blob = await renderExportSlide(state.slideIndex, graphics);
  graphics.remove();
  downloadBlob(blob, exportFilename(state.slideIndex));
}

async function downloadAllSlides() {
  if (!state.text.trim()) return showToast("ERR / TEXT_REQUIRED");
  elements.downloadAll.disabled = true;
  const graphics = state.p5.createGraphics(1080, 1350);
  graphics.pixelDensity(1);
  const zip = new JSZip();
  for (let index = 0; index < state.slides.length; index += 1) {
    zip.file(exportFilename(index), await renderExportSlide(index, graphics));
  }
  graphics.remove();
  downloadBlob(await zip.generateAsync({ type: "blob" }), `generative-thought-${pad(activeNumber())}.zip`);
  elements.downloadAll.disabled = false;
  showToast(`CAROUSEL_${pad(state.slides.length, 2)} / SAVED`);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function apiUrl(path) {
  return `${state.apiBase.replace(/\/$/, "")}${path}`;
}

async function checkInstagramStatus() {
  elements.instagramBackend.textContent = "CHECKING";
  elements.instagramAccount.textContent = "CHECKING";
  try {
    const response = await fetch(apiUrl("/api/instagram/status"), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const data = await response.json();
    state.instagramConnected = Boolean(data.configured);
    elements.instagramBackend.textContent = data.configured ? "READY" : "MISSING_SERVER_SECRETS";
    elements.instagramAccount.textContent = data.username ? `@${data.username}` : "NOT_CONNECTED";
    elements.instagramSettings.textContent = data.configured ? "INSTAGRAM/READY" : "INSTAGRAM/OFFLINE";
    elements.instagramMessage.textContent = data.configured ? "READY_TO_PUBLISH" : "ADD_SERVER_SECRETS_TO_ENABLE_PUBLISHING";
  } catch {
    state.instagramConnected = false;
    elements.instagramBackend.textContent = "UNREACHABLE";
    elements.instagramAccount.textContent = "NOT_CONNECTED";
    elements.instagramSettings.textContent = "INSTAGRAM/OFFLINE";
    elements.instagramMessage.textContent = "PUBLISH_SERVER_UNREACHABLE";
  }
}

function openInstagramDialog() {
  elements.apiBaseInput.value = state.apiBase;
  if (!elements.captionInput.value) elements.captionInput.value = state.title || "";
  elements.instagramDialog.showModal();
  checkInstagramStatus();
}

function saveInstagramServer() {
  state.apiBase = elements.apiBaseInput.value.trim().replace(/\/$/, "");
  if (state.apiBase) localStorage.setItem(STORAGE.apiBase, state.apiBase);
  else localStorage.removeItem(STORAGE.apiBase);
  checkInstagramStatus();
  showToast("PUBLISH_SERVER / SAVED");
}

async function publishToInstagram() {
  if (!state.text.trim()) return showToast("ERR / TEXT_REQUIRED");
  if (!state.instagramConnected) {
    elements.instagramMessage.textContent = "ERR / SERVER_OR_ACCOUNT_NOT_CONFIGURED";
    return;
  }
  elements.confirmPublish.disabled = true;
  elements.confirmPublish.textContent = "RENDERING…";
  try {
    const graphics = state.p5.createGraphics(1080, 1350);
    graphics.pixelDensity(1);
    const slides = [];
    for (let index = 0; index < state.slides.length; index += 1) {
      elements.confirmPublish.textContent = `RENDER ${index + 1}/${state.slides.length}`;
      slides.push(await blobToDataURL(await renderExportSlide(index, graphics)));
    }
    graphics.remove();
    elements.confirmPublish.textContent = "PUBLISHING…";
    const response = await fetch(apiUrl("/api/instagram/publish"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Publish-Secret": state.passphrase },
      body: JSON.stringify({ slides, caption: elements.captionInput.value, index: activeNumber(), title: state.title }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP_${response.status}`);
    elements.instagramMessage.textContent = `PUBLISHED / MEDIA_${data.mediaId}`;
    showToast("INSTAGRAM_CAROUSEL / PUBLISHED");
  } catch (error) {
    elements.instagramMessage.textContent = `ERR / ${error.message}`;
  } finally {
    elements.confirmPublish.disabled = false;
    elements.confirmPublish.textContent = "PUBLISH NOW";
  }
}

let toastTimer;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

function resetStudio() {
  if (!window.confirm("Reset the local index? This removes the passphrase and every saved thought from this browser.")) return;
  Object.values(STORAGE).forEach((key) => localStorage.removeItem(key));
  window.location.reload();
}

elements.lockForm.addEventListener("submit", handleLockSubmit);
elements.lockButton.addEventListener("click", lockStudio);
elements.titleInput.addEventListener("input", (event) => {
  state.title = event.target.value;
  state.mlVector = null;
  state.mlStatus = "LEXICAL";
  refreshSlides();
  queueDraftSave();
});
elements.thoughtInput.addEventListener("input", (event) => {
  state.text = event.target.value;
  state.mlVector = null;
  state.mlStatus = "LEXICAL";
  state.slideIndex = 0;
  refreshSlides();
  queueDraftSave();
});
elements.patternSelect.addEventListener("change", (event) => {
  state.pattern = event.target.value;
  refreshSlides();
  queueDraftSave();
});
elements.paletteSelect.addEventListener("change", (event) => {
  state.palette = event.target.value;
  refreshSlides();
  queueDraftSave();
});
elements.modelButton.addEventListener("click", runLocalModel);
elements.saveButton.addEventListener("click", saveThought);
elements.randomizeButton.addEventListener("click", randomizePattern);
elements.newButton.addEventListener("click", newThought);
elements.archiveList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-entry-id]");
  if (button) loadEntry(button.dataset.entryId);
});
elements.sequence.addEventListener("click", (event) => {
  const button = event.target.closest("[data-slide-index]");
  if (!button) return;
  state.slideIndex = Number(button.dataset.slideIndex);
  renderSequence();
});
elements.previousSlide.addEventListener("click", () => {
  state.slideIndex = Math.max(0, state.slideIndex - 1);
  renderSequence();
});
elements.nextSlide.addEventListener("click", () => {
  state.slideIndex = Math.min(state.slides.length - 1, state.slideIndex + 1);
  renderSequence();
});
elements.downloadCurrent.addEventListener("click", downloadCurrentSlide);
elements.downloadAll.addEventListener("click", downloadAllSlides);
elements.publishButton.addEventListener("click", openInstagramDialog);
elements.instagramSettings.addEventListener("click", openInstagramDialog);
elements.saveInstagramSettings.addEventListener("click", saveInstagramServer);
elements.confirmPublish.addEventListener("click", publishToInstagram);
elements.resetPasscode.addEventListener("click", resetStudio);

new p5((sketch) => {
  sketch.setup = () => {
    const renderer = sketch.createCanvas(1080, 1350);
    renderer.parent(elements.previewCanvas);
    renderer.attribute("aria-hidden", "true");
    sketch.pixelDensity(1);
    sketch.frameRate(12);
    state.p5 = sketch;
    refreshSlides();
  };
  sketch.draw = () => {
    if (!elements.app.hidden && state.slides.length) drawSlide(state.slideIndex, sketch, sketch.millis() / 1000);
  };
}, elements.previewCanvas);

setLockMode();
elements.passcode.focus();
