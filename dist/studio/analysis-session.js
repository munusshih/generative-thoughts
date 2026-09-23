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
    const savedImageInterlude = state.machineAnalysis?.imageInterlude || null;

    activeAnalysis = (async () => {
      showProgress({ stage: "saving-draft", overallPercent: 3 });
      const saved = await saveNow();
      if (!saved) throw new Error("Save the thought before analysis.");
      if (revision !== state.revision || analysisContext !== state.contextVersion) {
        throw new Error("The writing changed. Run analysis again.");
      }

      state.analyzingRevision = revision;
      showProgress({ stage: "loading-runtime", overallPercent: 7 });
      const { analyzeLocally } = await import("../ai.js");
      const local = await analyzeLocally(state.title, state.text, showProgress);

      if (revision !== state.revision || analysisContext !== state.contextVersion) {
        throw new Error("The writing changed. Run analysis again.");
      }

      showProgress({ stage: "saving-analysis", overallPercent: 98 });
      const stored = await saveAnalysis({
        id: state.id,
        sourceUpdatedAt: state.updatedAt,
        imageInterlude: savedImageInterlude,
        ...local,
      });

      if (revision !== state.revision || analysisContext !== state.contextVersion) {
        throw new Error("The writing changed. Run analysis again.");
      }

      state.machineAnalysis = stored;
      state.slideIndex = Number.MAX_SAFE_INTEGER;
      showProgress({ stage: "saved", overallPercent: 100 });
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
