export function getAnalysisPolicy(state) {
  const hasSavedAnalysis = Boolean(state?.machineAnalysis);

  return {
    hasSavedAnalysis,
    analysisButtonLabel: hasSavedAnalysis ? "RE-ANALYZE" : "ANALYSIS",
    confirmAnalysisReplacement: hasSavedAnalysis,
  };
}

export function getImagePolicy(state) {
  const hasSavedAnalysis = Boolean(state?.machineAnalysis);
  const hasSavedImage = Boolean(state?.machineAnalysis?.imageInterlude);

  return {
    hasSavedAnalysis,
    hasSavedImage,
    imageButtonLabel: hasSavedImage ? "REGENERATE IMAGE" : "GENERATE IMAGE",
    confirmImageReplacement: hasSavedImage,
  };
}

export function getPublishPolicy(state) {
  const hasSavedAnalysis = Boolean(
    String(state?.machineAnalysis?.synthesis?.reflection || "").trim(),
  );
  const hasSavedImage = Boolean(state?.machineAnalysis?.imageInterlude);

  if (!hasSavedAnalysis && !hasSavedImage) {
    return {
      hasSavedAnalysis,
      hasSavedImage,
      confirmPublish: true,
      confirmation: {
        title: "Analysis and image missing",
        message:
          "You have not generated an AI analysis or source image for this thought. Publish without both pages?",
        confirmLabel: "PUBLISH ANYWAY",
      },
    };
  }

  if (!hasSavedAnalysis) {
    return {
      hasSavedAnalysis,
      hasSavedImage,
      confirmPublish: true,
      confirmation: {
        title: "No analysis yet",
        message:
          "You have not analyzed this thought yet. Publish without an AI synthesis page?",
        confirmLabel: "PUBLISH ANYWAY",
      },
    };
  }

  if (!hasSavedImage) {
    return {
      hasSavedAnalysis,
      hasSavedImage,
      confirmPublish: true,
      confirmation: {
        title: "No image yet",
        message:
          "You have not generated a source image for this thought. Publish without the image page?",
        confirmLabel: "PUBLISH ANYWAY",
      },
    };
  }

  return {
    hasSavedAnalysis,
    hasSavedImage,
    confirmPublish: false,
    confirmation: null,
  };
}
