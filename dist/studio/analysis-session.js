import { saveAnalysis } from "../archive.js";

export function createAnalysisSession({
  state,
  saveNow,
  showProgress,
  hideProgress,
  refreshPreview,
}) {
  let activeAnalysis = null;

  async function analyze() {
    if (activeAnalysis) return activeAnalysis;
    if (!state.text.trim()) throw new Error("Write something before analysis.");

    const revision = state.revision;
    const analysisContext = state.contextVersion;

    activeAnalysis = (async () => {
      const saved = await saveNow();
      if (!saved) throw new Error("Save the thought before analysis.");
      if (revision !== state.revision || analysisContext !== state.contextVersion) {
        throw new Error("The writing changed. Run analysis again.");
      }

      state.analyzingRevision = revision;
      const { analyzeLocally } = await import("../ai.js");
      const local = await analyzeLocally(state.title, state.text, showProgress);

      if (revision !== state.revision || analysisContext !== state.contextVersion) {
        throw new Error("The writing changed. Run analysis again.");
      }

      const stored = await saveAnalysis({
        id: state.id,
        sourceUpdatedAt: state.updatedAt,
        ...local,
      });

      if (revision !== state.revision || analysisContext !== state.contextVersion) {
        throw new Error("The writing changed. Run analysis again.");
      }

      state.machineAnalysis = stored;
      state.slideIndex = Number.MAX_SAFE_INTEGER;
      refreshPreview();
      return stored;
    })();

    try {
      return await activeAnalysis;
    } finally {
      state.analyzingRevision = null;
      activeAnalysis = null;
      hideProgress();
    }
  }

  return { analyze };
}
