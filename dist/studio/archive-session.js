import { AUTO_SAVE_MS } from "../config.js";
import {
  listThoughts,
  loadThought,
  saveThought,
} from "../archive.js";
import {
  NEW_THOUGHT,
  applyStoredThought,
  persistRecovery,
  resetToNewThought,
} from "./state.js";

export function createArchiveSession({
  state,
  onArchiveChanged,
  onStateChanged,
  onError,
}) {
  let thoughts = [];
  let saveChain = Promise.resolve();

  function notifyArchive() {
    onArchiveChanged?.(thoughts);
  }

  async function refresh() {
    const data = await listThoughts();
    thoughts = Array.isArray(data.thoughts) ? data.thoughts : [];
    state.nextIndex = data.nextIndex || 1;
    notifyArchive();
    return thoughts;
  }

  function saveNow() {
    clearTimeout(state.saveTimer);
    const requestedContext = state.contextVersion;

    saveChain = saveChain.catch(() => null).then(async () => {
      if (requestedContext !== state.contextVersion) return null;

      persistRecovery(state);
      if (!state.text.trim()) return null;

      const saved = await saveThought({
        id: state.id,
        title: state.title,
        text: state.text,
        createdAt: state.createdAt,
        typingMs: state.typing.activeMs,
        visualSeed: state.visualSeed,
      });

      if (requestedContext !== state.contextVersion) return saved;

      state.id = saved.id;
      state.currentIndex = saved.index;
      state.createdAt = saved.createdAt;
      state.updatedAt = saved.updatedAt;
      persistRecovery(state);
      await refresh();
      return saved;
    });

    return saveChain;
  }

  function queueSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      saveNow().catch((error) => onError?.(error, "Autosave failed"));
    }, AUTO_SAVE_MS);
  }

  async function switchTo(targetId) {
    if (targetId === (state.id || NEW_THOUGHT)) return;

    await saveNow();

    if (targetId === NEW_THOUGHT) {
      resetToNewThought(state);
    } else {
      applyStoredThought(state, await loadThought(targetId));
    }

    persistRecovery(state);
    notifyArchive();
    onStateChanged?.();
  }

  async function reconcileRecovery() {
    const archived = state.id
      ? thoughts.find((thought) => thought.id === state.id)
      : null;

    if (state.id && !archived) {
      state.id = null;
      state.currentIndex = null;
      state.createdAt = new Date().toISOString();
      persistRecovery(state);
      notifyArchive();
    } else if (archived) {
      const stored = await loadThought(archived.id);

      if (stored.title === state.title && stored.text === state.text) {
        state.machineAnalysis = stored.machineAnalysis || null;
      } else {
        queueSave();
      }
    }

    if (!state.id && state.text.trim()) {
      queueSave();
    }
  }

  return {
    get thoughts() {
      return thoughts;
    },
    queueSave,
    reconcileRecovery,
    refresh,
    saveNow,
    switchTo,
  };
}
