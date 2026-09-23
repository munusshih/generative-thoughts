import {
  findImageInterlude,
  saveAnalysisImage,
} from "../archive.js";

export function createImageSession({
  state,
  saveNow,
  reuseStoredAnalysis,
  showProgress,
  hideProgress,
  refreshPreview,
}) {
  let activeGeneration = null;

  async function generate() {
    if (activeGeneration) return activeGeneration;
    if (!state.text.trim()) throw new Error("Write something before generating an image.");

    const revision = state.revision;
    const imageContext = state.contextVersion;

    activeGeneration = (async () => {
      showProgress({ label: "SAVING WRITING", percent: 5 });
      const saved = await saveNow();
      if (!saved) throw new Error("Save the thought before generating an image.");

      if (revision !== state.revision || imageContext !== state.contextVersion) {
        throw new Error("The writing changed. Generate the image again.");
      }

      const analysis = await reuseStoredAnalysis();
      const reflection = String(analysis?.synthesis?.reflection || "").trim();

      if (!reflection) {
        throw new Error("Run analysis before generating an image.");
      }

      showProgress({ label: "FINDING SOURCE IMAGE", percent: 30 });
      const result = await findImageInterlude({
        id: state.id,
        sourceUpdatedAt: state.updatedAt,
        reflection,
      });

      if (revision !== state.revision || imageContext !== state.contextVersion) {
        throw new Error("The writing changed. Generate the image again.");
      }

      if (!result.imageInterlude) {
        throw new Error(result.warning || "No suitable source image was found.");
      }

      showProgress({ label: "SAVING IMAGE", percent: 85 });
      const stored = await saveAnalysisImage({
        id: state.id,
        sourceUpdatedAt: state.updatedAt,
        imageInterlude: result.imageInterlude,
      });

      if (revision !== state.revision || imageContext !== state.contextVersion) {
        throw new Error("The writing changed. Generate the image again.");
      }

      state.machineAnalysis = stored;
      refreshPreview();

      const imageSlide = state.slides.findIndex(
        (slide) => slide.type === "image-interlude",
      );

      if (imageSlide >= 0) state.slideIndex = imageSlide;

      showProgress({ label: "IMAGE COMPLETE", percent: 100 });
      refreshPreview();
      return stored;
    })();

    try {
      return await activeGeneration;
    } finally {
      activeGeneration = null;
      hideProgress();
    }
  }

  return { generate };
}
