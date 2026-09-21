export function getAnalysisPolicy(state) {
  const hasSavedAnalysis = Boolean(state?.machineAnalysis);

  return {
    hasSavedAnalysis,
    analysisButtonLabel: hasSavedAnalysis ? "RE-ANALYZE" : "ANALYSIS",
    confirmAnalysisReplacement: hasSavedAnalysis,
    confirmPublishWithoutAnalysis: !hasSavedAnalysis,
  };
}
