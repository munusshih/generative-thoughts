import p5 from "p5";
import JSZip from "jszip";

const STORAGE = {
  settings: "generative-thoughts.settings.v1",
  entries: "generative-thoughts.entries.v1",
  draft: "generative-thoughts.draft.v1",
};

const PALETTES = {
  ink: { background: "#f4f0e8", foreground: "#101010", accent: "#ff5c35", support: "#2357ff" },
  blue: { background: "#2357ff", foreground: "#f7f3ea", accent: "#d9ff43", support: "#101010" },
  acid: { background: "#d9ff43", foreground: "#101010", accent: "#ff5c35", support: "#2357ff" },
};

const state = {
  settings: loadJSON(STORAGE.settings, null),
  entries: loadJSON(STORAGE.entries, []),
  currentId: null,
  text: "",
  pattern: "orbit",
  palette: "ink",
  visualSeed: 1,
  slides: [""],
  slideIndex: 0,
  saveTimer: null,
  p5: null,
};

const elements = {
  app: document.querySelector("#app"),
  lockScreen: document.querySelector("#lockScreen"),
  lockForm: document.querySelector("#lockForm"),
  lockCopy: document.querySelector("#lockCopy"),
  passcode: document.querySelector("#passcode"),
  unlockButton: document.querySelector("#unlockButton"),
  lockError: document.querySelector("#lockError"),
  lockButton: document.querySelector("#lockButton"),
  thoughtInput: document.querySelector("#thoughtInput"),
  thoughtNumber: document.querySelector("#thoughtNumber"),
  characterCount: document.querySelector("#characterCount"),
  patternSelect: document.querySelector("#patternSelect"),
  paletteSelect: document.querySelector("#paletteSelect"),
  saveButton: document.querySelector("#saveButton"),
  newButton: document.querySelector("#newButton"),
  randomizeButton: document.querySelector("#randomizeButton"),
  savedState: document.querySelector("#savedState"),
  archiveCount: document.querySelector("#archiveCount"),
  archiveList: document.querySelector("#archiveList"),
  canvasHost: document.querySelector("#previewCanvas"),
  canvasPlaceholder: document.querySelector("#canvasPlaceholder"),
  slideCount: document.querySelector("#slideCount"),
  slideDots: document.querySelector("#slideDots"),
  previousSlide: document.querySelector("#previousSlide"),
  nextSlide: document.querySelector("#nextSlide"),
  downloadCurrent: document.querySelector("#downloadCurrent"),
  downloadAll: document.querySelector("#downloadAll"),
  shareButton: document.querySelector("#shareButton"),
  exportNote: document.querySelector("#exportNote"),
  resetPasscode: document.querySelector("#resetPasscode"),
  toast: document.querySelector("#toast"),
};

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes = 16) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPasscode(passcode, salt) {
  const data = new TextEncoder().encode(`${salt}:${passcode}`);
  return bufferToHex(await crypto.subtle.digest("SHA-256", data));
}

function setLockMode() {
  const hasPasscode = Boolean(state.settings?.passcodeHash);
  elements.lockCopy.textContent = hasPasscode
    ? "Enter the passcode saved in this browser."
    : "Create a passcode for this browser. Your writing stays here unless you export it.";
  elements.unlockButton.textContent = hasPasscode ? "Unlock" : "Set passcode";
  elements.passcode.setAttribute("autocomplete", hasPasscode ? "current-password" : "new-password");
  elements.lockError.textContent = "";
}

async function handleLockSubmit(event) {
  event.preventDefault();
  const passcode = elements.passcode.value;
  if (passcode.length < 4) {
    elements.lockError.textContent = "Use at least 4 characters.";
    return;
  }

  if (!state.settings?.passcodeHash) {
    const salt = randomHex();
    state.settings = {
      passcodeHash: await hashPasscode(passcode, salt),
      salt,
      nextIndex: 1,
    };
    saveJSON(STORAGE.settings, state.settings);
  } else {
    const candidate = await hashPasscode(passcode, state.settings.salt);
    if (candidate !== state.settings.passcodeHash) {
      elements.lockError.textContent = "That passcode does not match this browser.";
      elements.passcode.select();
      return;
    }
  }

  elements.passcode.value = "";
  elements.lockScreen.hidden = true;
  elements.app.hidden = false;
  restoreDraft();
  refreshAll();
  elements.thoughtInput.focus();
}

function lockStudio() {
  elements.app.hidden = true;
  elements.lockScreen.hidden = false;
  setLockMode();
  elements.passcode.focus();
}

function pad(number, size = 3) {
  return String(number).padStart(size, "0");
}

function activeNumber() {
  const entry = state.entries.find((item) => item.id === state.currentId);
  return entry?.index ?? state.settings?.nextIndex ?? 1;
}

function splitTextExactly(text) {
  if (!text) return [""];
  const target = 300;
  const minimum = 190;
  const maximum = 380;
  const chunks = [];
  let cursor = 0;

  while (text.length - cursor > maximum) {
    const windowEnd = Math.min(cursor + maximum, text.length);
    const ideal = cursor + target;
    const searchStart = cursor + minimum;
    let breakAt = -1;

    for (let index = ideal; index < windowEnd; index += 1) {
      if (/\s/.test(text[index])) {
        breakAt = index + 1;
        break;
      }
    }
    if (breakAt < 0) {
      for (let index = ideal; index >= searchStart; index -= 1) {
        if (/\s/.test(text[index])) {
          breakAt = index + 1;
          break;
        }
      }
    }
    if (breakAt < 0) breakAt = windowEnd;
    chunks.push(text.slice(cursor, breakAt));
    cursor = breakAt;
  }

  chunks.push(text.slice(cursor));
  return chunks;
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

function drawPattern(graphics, pattern, palette, random, slideIndex) {
  const { background, foreground, accent, support } = palette;
  graphics.background(background);
  graphics.push();

  if (pattern === "orbit") {
    graphics.noFill();
    for (let index = 0; index < 16; index += 1) {
      const radius = 40 + random() * 280;
      const x = 70 + random() * 940;
      const y = 70 + random() * 1210;
      const color = index % 3 === 0 ? accent : index % 5 === 0 ? support : foreground;
      graphics.stroke(hexWithAlpha(color, 0.92));
      graphics.strokeWeight(5 + random() * 22);
      graphics.arc(x, y, radius * 2, radius * 2, random() * Math.PI, random() * Math.PI * 2 + Math.PI);
    }
    graphics.noStroke();
    graphics.fill(accent);
    graphics.circle(840 - slideIndex * 24, 225 + slideIndex * 35, 176);
  } else if (pattern === "weave") {
    graphics.noFill();
    graphics.strokeCap(graphics.ROUND);
    for (let row = -1; row < 12; row += 1) {
      const y = row * 125 + random() * 45;
      graphics.beginShape();
      for (let x = -80; x <= 1160; x += 80) {
        graphics.curveVertex(x, y + Math.sin((x + row * 90) / 120) * (45 + random() * 70));
      }
      const color = row % 3 === 0 ? accent : row % 2 === 0 ? foreground : support;
      graphics.stroke(hexWithAlpha(color, 0.68));
      graphics.strokeWeight(18 + random() * 30);
      graphics.endShape();
    }
  } else {
    const bars = 28;
    graphics.noStroke();
    for (let index = 0; index < bars; index += 1) {
      const width = 14 + random() * 60;
      const height = 80 + random() * 560;
      const x = index * (1080 / bars) - 20;
      const anchorBottom = index % 2 === 0;
      const color = index % 5 === 0 ? accent : index % 3 === 0 ? support : foreground;
      graphics.fill(hexWithAlpha(color, 0.3 + random() * 0.6));
      graphics.rect(x, anchorBottom ? 1350 - height : 0, width, height);
    }
    graphics.noFill();
    graphics.stroke(foreground);
    graphics.strokeWeight(9);
    graphics.beginShape();
    for (let x = 0; x <= 1080; x += 18) {
      const y = 250 + Math.sin(x / 42 + slideIndex) * (50 + random() * 90);
      graphics.vertex(x, y);
    }
    graphics.endShape();
  }
  graphics.pop();

  const wash = graphics.drawingContext.createLinearGradient(0, 350, 0, 1160);
  wash.addColorStop(0, hexWithAlpha(background, 0.1));
  wash.addColorStop(0.24, hexWithAlpha(background, 0.88));
  wash.addColorStop(0.84, hexWithAlpha(background, 0.92));
  wash.addColorStop(1, hexWithAlpha(background, 0.25));
  graphics.drawingContext.fillStyle = wash;
  graphics.drawingContext.fillRect(0, 300, 1080, 900);
}

function hexWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const red = (bigint >> 16) & 255;
  const green = (bigint >> 8) & 255;
  const blue = bigint & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function wrapCanvasText(graphics, text, maxWidth) {
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const lines = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
    } else {
      let line = words[0];
      for (const word of words.slice(1)) {
        const test = `${line} ${word}`;
        if (graphics.textWidth(test) <= maxWidth) line = test;
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

function fitText(graphics, text, maxWidth, maxHeight) {
  let fontSize = 74;
  let lines = [];
  let lineHeight = 0;
  while (fontSize >= 42) {
    graphics.textFont("Georgia");
    graphics.textStyle(graphics.BOLD);
    graphics.textSize(fontSize);
    lines = wrapCanvasText(graphics, text, maxWidth);
    lineHeight = fontSize * 1.18;
    if (lines.length * lineHeight <= maxHeight) break;
    fontSize -= 3;
  }
  return { fontSize, lines, lineHeight };
}

function drawSlide(index, graphics = state.p5) {
  if (!graphics) return;
  const palette = PALETTES[state.palette];
  const text = state.slides[index] ?? "";
  const seed = stringSeed(`${state.text}|${state.visualSeed}|${index}|${state.pattern}`);
  const random = mulberry32(seed);
  drawPattern(graphics, state.pattern, palette, random, index);

  const inset = 82;
  graphics.push();
  graphics.noStroke();
  graphics.fill(palette.foreground);
  graphics.textFont("Helvetica");
  graphics.textStyle(graphics.BOLD);
  graphics.textSize(30);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
  graphics.text("GENERATIVE THOUGHTS", inset, 104);
  graphics.textAlign(graphics.RIGHT, graphics.BASELINE);
  graphics.text(`#${pad(activeNumber())}`, 1080 - inset, 104);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);

  if (text) {
    const fitted = fitText(graphics, text.trim(), 1080 - inset * 2, 690);
    const blockHeight = fitted.lines.length * fitted.lineHeight;
    let y = 675 - blockHeight / 2 + fitted.fontSize;
    graphics.fill(palette.foreground);
    graphics.textFont("Georgia");
    graphics.textStyle(graphics.BOLD);
    graphics.textSize(fitted.fontSize);
    for (const line of fitted.lines) {
      if (line) graphics.text(line, inset, y);
      y += fitted.lineHeight;
    }
  }

  graphics.stroke(palette.foreground);
  graphics.strokeWeight(3);
  graphics.line(inset, 1232, 1080 - inset, 1232);
  graphics.noStroke();
  graphics.fill(palette.foreground);
  graphics.textFont("Helvetica");
  graphics.textStyle(graphics.BOLD);
  graphics.textSize(27);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);
  graphics.text(`GT—${pad(activeNumber())}`, inset, 1287);
  graphics.textAlign(graphics.RIGHT, graphics.BASELINE);
  graphics.text(`${pad(index + 1, 2)} / ${pad(state.slides.length, 2)}`, 1080 - inset, 1287);
  graphics.pop();
}

function refreshSlides() {
  state.slides = splitTextExactly(state.text);
  state.slideIndex = Math.min(state.slideIndex, state.slides.length - 1);
  elements.canvasPlaceholder.hidden = Boolean(state.text);
  drawSlide(state.slideIndex);
  renderSlideNavigation();
}

function renderSlideNavigation() {
  elements.slideCount.textContent = `${pad(state.slideIndex + 1, 2)} / ${pad(state.slides.length, 2)}`;
  elements.slideDots.innerHTML = state.slides
    .map((_, index) => `<span class="slide-dot${index === state.slideIndex ? " is-active" : ""}"></span>`)
    .join("");
  elements.previousSlide.disabled = state.slideIndex === 0;
  elements.nextSlide.disabled = state.slideIndex === state.slides.length - 1;
}

function updateDraftStatus(status = "Saved locally") {
  elements.savedState.textContent = status;
}

function persistDraft() {
  saveJSON(STORAGE.draft, {
    id: state.currentId,
    text: state.text,
    pattern: state.pattern,
    palette: state.palette,
    visualSeed: state.visualSeed,
  });
  updateDraftStatus();
}

function queueDraftSave() {
  updateDraftStatus("Saving…");
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(persistDraft, 250);
}

function restoreDraft() {
  const draft = loadJSON(STORAGE.draft, null);
  if (!draft) return;
  state.currentId = draft.id ?? null;
  state.text = draft.text ?? "";
  state.pattern = draft.pattern ?? "orbit";
  state.palette = draft.palette ?? "ink";
  state.visualSeed = draft.visualSeed ?? 1;
}

function refreshAll() {
  elements.thoughtInput.value = state.text;
  elements.patternSelect.value = state.pattern;
  elements.paletteSelect.value = state.palette;
  elements.characterCount.textContent = state.text.length.toLocaleString();
  elements.thoughtNumber.textContent = pad(activeNumber());
  renderArchive();
  refreshSlides();
}

function saveThought() {
  if (!state.text.trim()) {
    showToast("Write something before saving.");
    elements.thoughtInput.focus();
    return;
  }

  const now = new Date().toISOString();
  const existingIndex = state.entries.findIndex((item) => item.id === state.currentId);
  if (existingIndex >= 0) {
    state.entries[existingIndex] = {
      ...state.entries[existingIndex],
      text: state.text,
      pattern: state.pattern,
      palette: state.palette,
      visualSeed: state.visualSeed,
      updatedAt: now,
    };
    showToast(`Thought ${pad(state.entries[existingIndex].index)} updated.`);
  } else {
    const index = state.settings.nextIndex;
    const entry = {
      id: crypto.randomUUID(),
      index,
      text: state.text,
      pattern: state.pattern,
      palette: state.palette,
      visualSeed: state.visualSeed,
      createdAt: now,
      updatedAt: now,
    };
    state.entries.unshift(entry);
    state.currentId = entry.id;
    state.settings.nextIndex += 1;
    saveJSON(STORAGE.settings, state.settings);
    showToast(`Thought ${pad(index)} added to the index.`);
  }
  saveJSON(STORAGE.entries, state.entries);
  persistDraft();
  refreshAll();
}

function newThought() {
  state.currentId = null;
  state.text = "";
  state.pattern = "orbit";
  state.palette = "ink";
  state.visualSeed = Date.now() >>> 0;
  state.slideIndex = 0;
  persistDraft();
  refreshAll();
  elements.thoughtInput.focus();
}

function loadEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  state.currentId = entry.id;
  state.text = entry.text;
  state.pattern = entry.pattern;
  state.palette = entry.palette;
  state.visualSeed = entry.visualSeed;
  state.slideIndex = 0;
  persistDraft();
  refreshAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderArchive() {
  elements.archiveCount.textContent = state.entries.length;
  if (!state.entries.length) {
    elements.archiveList.innerHTML = '<p class="archive-empty">Saved thoughts will appear here.</p>';
    return;
  }
  elements.archiveList.innerHTML = state.entries
    .map((entry) => {
      const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(entry.updatedAt));
      return `
        <button class="archive-item" type="button" data-entry-id="${entry.id}">
          <span class="archive-number">${pad(entry.index)}</span>
          <span class="archive-excerpt">${escapeHTML(entry.text.replace(/\s+/g, " ").trim())}</span>
          <span class="archive-date">${date}</span>
        </button>`;
    })
    .join("");
}

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function randomizePattern() {
  state.visualSeed = crypto.getRandomValues(new Uint32Array(1))[0];
  refreshSlides();
  queueDraftSave();
  showToast("Pattern randomized. Text unchanged.");
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function exportFilename(index) {
  return `generative-thought-${pad(activeNumber())}-${pad(index + 1, 2)}.png`;
}

function downloadCurrentSlide() {
  if (!state.text.trim()) return showToast("Start writing before exporting.");
  drawSlide(state.slideIndex);
  downloadCanvas(state.p5.canvas, exportFilename(state.slideIndex));
}

async function downloadAllSlides() {
  if (!state.text.trim()) return showToast("Start writing before exporting.");
  const exportGraphics = state.p5.createGraphics(1080, 1350);
  exportGraphics.pixelDensity(1);
  const zip = new JSZip();
  for (let index = 0; index < state.slides.length; index += 1) {
    drawSlide(index, exportGraphics);
    const blob = await canvasToBlob(exportGraphics.canvas);
    zip.file(exportFilename(index), blob);
  }
  exportGraphics.remove();
  const archive = await zip.generateAsync({ type: "blob" });
  const link = document.createElement("a");
  link.download = `generative-thought-${pad(activeNumber())}.zip`;
  link.href = URL.createObjectURL(archive);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  drawSlide(state.slideIndex);
  showToast(`${state.slides.length} slides bundled as a ZIP.`);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function shareCurrentSlide() {
  if (!state.text.trim()) return showToast("Start writing before sharing.");
  drawSlide(state.slideIndex);
  const blob = await canvasToBlob(state.p5.canvas);
  const file = new File([blob], exportFilename(state.slideIndex), { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Generative Thought ${pad(activeNumber())}` });
    } catch (error) {
      if (error.name !== "AbortError") showToast("Sharing was not available.");
    }
  } else {
    downloadCurrentSlide();
    showToast("Downloaded instead — sharing is not supported here.");
  }
}

let toastTimer;
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

function resetStudio() {
  const confirmed = window.confirm("Reset this local studio? This removes the passcode and every saved thought from this browser.");
  if (!confirmed) return;
  Object.values(STORAGE).forEach((key) => localStorage.removeItem(key));
  window.location.reload();
}

elements.lockForm.addEventListener("submit", handleLockSubmit);
elements.lockButton.addEventListener("click", lockStudio);
elements.thoughtInput.addEventListener("input", (event) => {
  state.text = event.target.value;
  elements.characterCount.textContent = state.text.length.toLocaleString();
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
elements.saveButton.addEventListener("click", saveThought);
elements.newButton.addEventListener("click", newThought);
elements.randomizeButton.addEventListener("click", randomizePattern);
elements.previousSlide.addEventListener("click", () => {
  state.slideIndex = Math.max(0, state.slideIndex - 1);
  drawSlide(state.slideIndex);
  renderSlideNavigation();
});
elements.nextSlide.addEventListener("click", () => {
  state.slideIndex = Math.min(state.slides.length - 1, state.slideIndex + 1);
  drawSlide(state.slideIndex);
  renderSlideNavigation();
});
elements.archiveList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-entry-id]");
  if (button) loadEntry(button.dataset.entryId);
});
elements.downloadCurrent.addEventListener("click", downloadCurrentSlide);
elements.downloadAll.addEventListener("click", downloadAllSlides);
elements.shareButton.addEventListener("click", shareCurrentSlide);
elements.resetPasscode.addEventListener("click", resetStudio);

new p5((sketch) => {
  sketch.setup = () => {
    const renderer = sketch.createCanvas(1080, 1350);
    renderer.parent(elements.canvasHost);
    renderer.attribute("aria-hidden", "true");
    sketch.pixelDensity(1);
    sketch.noLoop();
    state.p5 = sketch;
    refreshSlides();
  };
}, elements.canvasHost);

setLockMode();
elements.passcode.focus();
