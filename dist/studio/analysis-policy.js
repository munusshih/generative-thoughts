export function getAnalysisPolicy(state) {
  const hasSavedAnalysis = Boolean(state?.machineAnalysis);

  return {
    hasSavedAnalysis,
    analysisButtonLabel: hasSavedAnalysis ? "RE-ANALYZE" : "ANALYSIS",
    confirmAnalysisReplacement: hasSavedAnalysis,
    confirmPublishWithoutAnalysis: !hasSavedAnalysis,
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
