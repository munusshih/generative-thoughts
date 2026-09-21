import { STORAGE } from "../config.js";
import {
  loadJSON,
  normalizeTyping,
  saveJSON,
  stringSeed,
} from "../helpers.js";

export const NEW_THOUGHT = "__new__";

function freshVisualSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export function createStudioState() {
  return {
    id: null,
    currentIndex: null,
    nextIndex: 1,
    title: "",
    text: "",
    createdAt: new Date().toISOString(),
    updatedAt: null,
    typing: normalizeTyping(),
    visualSeed: freshVisualSeed(),
    machineAnalysis: null,
    aiProgress: null,
    slides: [],
    slideIndex: 0,
    p5: null,
    saveTimer: null,
    revision: 0,
    analyzingRevision: null,
    contextVersion: 0,
  };
}

export function persistRecovery(state) {
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

export function restoreRecovery(state) {
  const draft = loadJSON(STORAGE.draft, null);
  if (!draft) return false;

  Object.assign(state, {
    id: draft.id ?? null,
    currentIndex: draft.currentIndex ?? null,
    title: draft.title ?? "",
    text: draft.text ?? "",
    createdAt: draft.createdAt ?? new Date().toISOString(),
    updatedAt: draft.updatedAt ?? null,
    typing: normalizeTyping(draft.typing),
    visualSeed:
      draft.visualSeed ?? stringSeed(`${draft.title || ""}|${draft.text || ""}`),
  });

  return true;
}

export function resetToNewThought(state) {
  state.contextVersion += 1;
  clearTimeout(state.saveTimer);

  Object.assign(state, {
    id: null,
    currentIndex: null,
    title: "",
    text: "",
    createdAt: new Date().toISOString(),
    updatedAt: null,
    typing: normalizeTyping(),
    visualSeed: freshVisualSeed(),
    machineAnalysis: null,
    aiProgress: null,
    slideIndex: 0,
    revision: state.revision + 1,
    analyzingRevision: null,
  });
}

export function applyStoredThought(state, thought) {
  state.contextVersion += 1;
  clearTimeout(state.saveTimer);

  Object.assign(state, {
    id: thought.id,
    currentIndex: thought.index,
    title: thought.title || "",
    text: thought.text || "",
    createdAt: thought.createdAt || new Date().toISOString(),
    updatedAt: thought.updatedAt || null,
    typing: normalizeTyping({ activeMs: Number(thought.typingMs) || 0 }),
    visualSeed:
      Number(thought.visualSeed) || stringSeed(`${thought.title || ""}|${thought.text || ""}`),
    machineAnalysis: thought.machineAnalysis || null,
    aiProgress: null,
    slideIndex: 0,
    revision: state.revision + 1,
    analyzingRevision: null,
  });
}
