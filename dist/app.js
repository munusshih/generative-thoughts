import p5 from "p5";

import {
  CANVAS,
  PRINT_FONT,
  printFontReady,
} from "./config.js";

import { trackTyping } from "./helpers.js";

import {
  applyThemeToDocument,
  buildSlides,
  drawSlide,
} from "./visuals.js";

import { publishCarousel } from "./export.js";
import { createAnalysisSession } from "./studio/analysis-session.js";
import { createArchiveSession } from "./studio/archive-session.js";
import {
  NEW_THOUGHT,
  createStudioState,
  persistRecovery,
  restoreRecovery,
} from "./studio/state.js";

const elements = {
  title: document.querySelector("#titleInput"),
  text: document.querySelector("#thoughtInput"),
  preview: document.querySelector("#previewCanvas"),
  switcher: document.querySelector("#thoughtSwitcher"),
  randomVisual: document.querySelector("#randomVisualButton"),
  publish: document.querySelector("#publishButton"),
  analysis: document.querySelector("#analysisButton"),
  progress: document.querySelector("#modelProgress"),
  progressFill: document.querySelector("#modelProgressFill"),
  toast: document.querySelector("#toast"),
};

const state = createStudioState();

let archiveThoughts = [];
let toastTimer;
let progressFrame;
let modelProgressValue = 0;

function errorMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message && message.length <= 120 ? message : fallback;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function showModelProgress(progress) {
  state.aiProgress = progress || null;
  elements.progress.classList.add("is-active");

  const reported = Number.isFinite(progress?.percent)
    ? progress.percent
    : progress?.progress;

  if (Number.isFinite(reported)) {
    modelProgressValue = Math.max(modelProgressValue, reported);
  } else {
    modelProgressValue = Math.max(modelProgressValue, 2);
  }

  elements.progressFill.style.width = `${Math.min(100, modelProgressValue)}%`;

  if (!progressFrame) {
    progressFrame = requestAnimationFrame(() => {
      progressFrame = null;
      refreshPreview();
    });
  }
}

function hideModelProgress() {
  state.aiProgress = null;
  modelProgressValue = 0;
  elements.progressFill.style.width = "0%";
  elements.progress.classList.remove("is-active");
  refreshPreview();
}

function refreshPreview() {
  if (!state.p5) return;

  applyThemeToDocument(state);
  buildSlides(state, state.p5);
  state.slideIndex = Math.min(state.slideIndex, Math.max(0, state.slides.length - 1));
  drawSlide(state.slideIndex, state, state.p5, performance.now() / 1000);
}

function autosizeTitle() {
  elements.title.style.height = "auto";
  elements.title.style.height = `${Math.max(24, elements.title.scrollHeight)}px`;
}

function updateEditor() {
  elements.title.value = state.title;
  elements.text.value = state.text;
  autosizeTitle();
}

function renderThoughtSwitcher() {
  if (!elements.switcher) return;

  const fragment = document.createDocumentFragment();
  const newOption = document.createElement("option");
  newOption.value = NEW_THOUGHT;
  newOption.textContent = "+ new thought";
  fragment.append(newOption);

  for (const thought of archiveThoughts) {
    const option = document.createElement("option");
    option.value = thought.id;
    const number = String(thought.index || 0).padStart(3, "0");
    option.textContent = `#${number} ${thought.title || "Untitled"}`;
    fragment.append(option);
  }

  elements.switcher.replaceChildren(fragment);
  elements.switcher.value = state.id || NEW_THOUGHT;
}

const archiveSession = createArchiveSession({
  state,
  onArchiveChanged(thoughts) {
    archiveThoughts = thoughts;
    renderThoughtSwitcher();
  },
  onStateChanged() {
    updateEditor();
    refreshPreview();
  },
  onError(error, fallback) {
    console.error(error);
    toast(errorMessage(error, fallback));
  },
});

const analysisSession = createAnalysisSession({
  state,
  saveNow: () => archiveSession.saveNow(),
  showProgress: showModelProgress,
  hideProgress: hideModelProgress,
  refreshPreview,
});

async function switchThought(targetId) {
  if (targetId === (state.id || NEW_THOUGHT)) return;

  elements.switcher.disabled = true;

  try {
    await archiveSession.switchTo(targetId);
  } catch (error) {
    console.error(error);
    renderThoughtSwitcher();
    toast(errorMessage(error, "Could not open that thought"));
  } finally {
    elements.switcher.disabled = false;
  }
}

function recordInput() {
  state.typing = trackTyping(state.typing);
  state.machineAnalysis = null;
  state.slideIndex = 0;
  state.revision += 1;
  persistRecovery(state);
  refreshPreview();
  archiveSession.queueSave();
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

elements.switcher?.addEventListener("change", (event) => {
  switchThought(event.target.value).catch(console.error);
});

elements.randomVisual?.addEventListener("click", () => {
  state.visualSeed = crypto.getRandomValues(new Uint32Array(1))[0];
  state.revision += 1;
  state.slideIndex = 0;
  persistRecovery(state);
  refreshPreview();
  archiveSession.queueSave();
});

elements.preview.addEventListener("click", () => {
  if (!state.slides.length) return;
  state.slideIndex = (state.slideIndex + 1) % state.slides.length;
  refreshPreview();
});

elements.preview.addEventListener("keydown", (event) => {
  if (!state.slides.length) return;

  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    state.slideIndex = (state.slideIndex + 1) % state.slides.length;
    refreshPreview();
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    state.slideIndex = (state.slideIndex - 1 + state.slides.length) % state.slides.length;
    refreshPreview();
  }
});

elements.analysis?.addEventListener("click", async () => {
  elements.analysis.disabled = true;
  elements.publish.disabled = true;

  try {
    await analysisSession.analyze();
    toast("Analysis saved");
  } catch (error) {
    console.error(error);
    toast(errorMessage(error, "Analysis failed"));
  } finally {
    elements.analysis.disabled = false;
    elements.publish.disabled = false;
  }
});

elements.publish.addEventListener("click", async () => {
  elements.publish.disabled = true;
  elements.analysis.disabled = true;

  try {
    const saved = await archiveSession.saveNow();
    if (!saved) throw new Error("Write something before publishing.");

    if (!state.machineAnalysis) {
      await analysisSession.analyze();
    }

    const result = await publishCarousel(state);
    toast(`Published ${result.images.length} JPGs and ${result.videos.length} MP4s`);
  } catch (error) {
    console.error(error);
    toast(errorMessage(error, "Publish failed"));
  } finally {
    elements.publish.disabled = false;
    elements.analysis.disabled = false;
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
  elements.preview,
);

restoreRecovery(state);
updateEditor();

try {
  await archiveSession.refresh();
  await archiveSession.reconcileRecovery();
} catch (error) {
  console.error(error);
  toast("Archive unavailable");
}

refreshPreview();
elements.text.focus();
