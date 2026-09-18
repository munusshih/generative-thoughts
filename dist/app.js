import p5 from "p5";

import {
  AUTO_ANALYZE_MS,
  AUTO_SAVE_MS,
  CANVAS,
  PRINT_FONT,
  STORAGE,
  printFontReady,
} from "./config.js";

import {
  loadJSON,
  normalizeTyping,
  saveJSON,
  stringSeed,
  trackTyping,
} from "./helpers.js";

import {
  listThoughts,
  saveAnalysis,
  saveThought,
} from "./archive.js";

import {
  analyzeLocally,
  warmModels,
} from "./ai.js";

import {
  applyThemeToDocument,
  buildSlides,
  drawSlide,
} from "./visuals.js";

import { publishCarousel } from "./export.js";

const elements = {
  title: document.querySelector("#titleInput"),
  text: document.querySelector("#thoughtInput"),
  preview: document.querySelector("#previewCanvas"),
  publish: document.querySelector("#publishButton"),
  progress: document.querySelector("#modelProgress"),
  progressFill: document.querySelector("#modelProgressFill"),
  toast: document.querySelector("#toast"),
};

const state = {
  id: null,
  currentIndex: null,
  nextIndex: 1,

  title: "",
  text: "",

  createdAt: new Date().toISOString(),
  updatedAt: null,

  typing: normalizeTyping(),

  visualSeed: crypto.getRandomValues(new Uint32Array(1))[0],
  machineAnalysis: null,

  slides: [],
  slideIndex: 0,

  p5: null,
  saveTimer: null,
  analysisTimer: null,
  revision: 0,
  analyzingRevision: null,
};

let toastTimer;
let modelProgressValue = 0;

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 1600);
}

function showModelProgress(progress) {
  elements.progress.classList.add("is-active");

  if (typeof progress?.progress === "number") {
    modelProgressValue = Math.max(modelProgressValue, progress.progress);
  } else {
    modelProgressValue = Math.max(modelProgressValue, 2);
  }

  elements.progressFill.style.width = `${Math.min(100, modelProgressValue)}%`;
}

function hideModelProgress() {
  modelProgressValue = 0;
  elements.progressFill.style.width = "0%";
  elements.progress.classList.remove("is-active");
}

function persistRecovery() {
  saveJSON(STORAGE.draft, {
    id: state.id,
    currentIndex: state.currentIndex,
    title: state.title,
    text: state.text,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    typing: state.typing,
    visualSeed: state.visualSeed,
  });
}

function restoreRecovery() {
  const draft = loadJSON(STORAGE.draft, null);
  if (!draft) return;

  Object.assign(state, {
    id: draft.id ?? null,
    currentIndex: draft.currentIndex ?? null,
    title: draft.title ?? "",
    text: draft.text ?? "",
    createdAt: draft.createdAt ?? new Date().toISOString(),
    updatedAt: draft.updatedAt ?? null,
    typing: normalizeTyping(draft.typing),
    visualSeed: draft.visualSeed ?? stringSeed(`${draft.title || ""}|${draft.text || ""}`),
  });
}

function refreshPreview() {
  if (!state.p5) return;

  applyThemeToDocument(state);
  buildSlides(state, state.p5);

  state.slideIndex = Math.min(
    state.slideIndex,
    Math.max(0, state.slides.length - 1)
  );

  drawSlide(state.slideIndex, state, state.p5, performance.now() / 1000);
}

function autosizeTitle() {
  elements.title.style.height = "auto";
  elements.title.style.height = `${Math.max(24, elements.title.scrollHeight)}px`;
}

async function refreshArchiveIndex() {
  try {
    const data = await listThoughts();
    state.nextIndex = data.nextIndex || 1;
  } catch {}
}

async function saveNow() {
  persistRecovery();

  if (!state.text.trim()) return null;

  const saved = await saveThought({
    id: state.id,
    index: state.currentIndex || state.nextIndex,
    title: state.title,
    text: state.text,
    createdAt: state.createdAt,
    typingMs: state.typing.activeMs,
    visualSeed: state.visualSeed,
  });

  state.id = saved.id;
  state.currentIndex = saved.index;
  state.createdAt = saved.createdAt;
  state.updatedAt = saved.updatedAt;

  persistRecovery();
  await refreshArchiveIndex();

  return saved;
}

function queueSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { saveNow().catch(() => {}); }, AUTO_SAVE_MS);
}

function queueAnalysis() {
  clearTimeout(state.analysisTimer);
  if (state.text.trim().length < 80) return;

  const revision = state.revision;
  state.analysisTimer = setTimeout(() => {
    runAutomaticAnalysis(revision).catch(() => {});
  }, AUTO_ANALYZE_MS);
}

async function runAutomaticAnalysis(revision) {
  if (state.analyzingRevision === revision) return;
  if (revision !== state.revision) return;
  if (state.text.trim().length < 80) return;

  const saved = await saveNow();
  if (!saved || revision !== state.revision) return;

  state.analyzingRevision = revision;

  try {
    modelProgressValue = 0;
    elements.progress.classList.add("is-active");

    const local = await analyzeLocally(
      state.title,
      state.text,
      showModelProgress
    );

    if (revision !== state.revision) return;

    const stored = await saveAnalysis({
      id: state.id,
      ...local,
    });

    if (revision !== state.revision) return;

    state.machineAnalysis = stored;
    refreshPreview();
  } catch (error) {
    console.error(error);
  } finally {
    if (state.analyzingRevision === revision) {
      state.analyzingRevision = null;
    }
    hideModelProgress();
  }
}

function recordInput() {
  state.typing = trackTyping(state.typing);
  state.machineAnalysis = null;
  state.slideIndex = 0;
  state.revision += 1;

  persistRecovery();
  refreshPreview();
  queueSave();
  queueAnalysis();
}

elements.title.addEventListener("input", (event) => {
  state.title = event.target.value;
  autosizeTitle();
  recordInput();
});

elements.text.addEventListener("input", (event) => {
  state.text = event.target.value;
  recordInput();
});

elements.preview.addEventListener("click", () => {
  if (!state.slides.length) return;
  state.slideIndex = (state.slideIndex + 1) % state.slides.length;
});

elements.preview.addEventListener("keydown", (event) => {
  if (!state.slides.length) return;

  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    state.slideIndex = (state.slideIndex + 1) % state.slides.length;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    state.slideIndex = (state.slideIndex - 1 + state.slides.length) % state.slides.length;
  }
});

elements.publish.addEventListener("click", async () => {
  elements.publish.disabled = true;

  try {
    await saveNow();

    if (state.text.trim().length >= 80 && !state.machineAnalysis) {
      await runAutomaticAnalysis(state.revision);
    }

    await publishCarousel(state);
    toast("Published");
  } catch (error) {
    console.error(error);
    toast("Publish failed");
  } finally {
    elements.publish.disabled = false;
  }
});

new p5(
  (sketch) => {
    sketch.setup = () => {
      const renderer = sketch.createCanvas(CANVAS.width, CANVAS.height);
      renderer.parent(elements.preview);
      renderer.attribute("aria-hidden", "true");

      sketch.pixelDensity(1);
      sketch.frameRate(12);
      sketch.textFont(PRINT_FONT);

      state.p5 = sketch;

      refreshPreview();
      printFontReady.then(refreshPreview);
    };

    sketch.draw = () => {
      if (!state.slides.length) return;
      drawSlide(state.slideIndex, state, sketch, sketch.millis() / 1000);
    };
  },
  elements.preview
);

restoreRecovery();

elements.title.value = state.title;
elements.text.value = state.text;
autosizeTitle();

await refreshArchiveIndex();
refreshPreview();

if ("requestIdleCallback" in window) {
  requestIdleCallback(
    () => warmModels(showModelProgress).then(hideModelProgress).catch(hideModelProgress),
    { timeout: 2500 }
  );
} else {
  setTimeout(
    () => warmModels(showModelProgress).then(hideModelProgress).catch(hideModelProgress),
    1200
  );
}

elements.text.focus();
