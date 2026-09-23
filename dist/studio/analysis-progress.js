const STAGES = {
  "saving-draft": { label: "SAVING WRITING", percent: 3, rank: 1 },
  "loading-runtime": { label: "STARTING LOCAL AI", percent: 7, rank: 2 },
  loading: { label: "LOADING LOCAL MODEL", percent: 10, rank: 3 },
  generating: { label: "WRITING SYNTHESIS", percent: 48, rank: 4 },
  retrying: { label: "REFINING SYNTHESIS", percent: 58, rank: 4 },
  complete: { label: "FINALIZING ANALYSIS", percent: 94, rank: 5 },
  "finding-image": { label: "FINDING SOURCE IMAGE", percent: 96, rank: 6 },
  "saving-analysis": { label: "SAVING ANALYSIS", percent: 98, rank: 7 },
  saved: { label: "ANALYSIS COMPLETE", percent: 100, rank: 8 },
};

export function initialAnalysisProgress() {
  return {
    label: "PREPARING ANALYSIS",
    percent: 0,
    rank: 0,
  };
}

function reportedPercent(progress) {
  const value = Number.isFinite(progress?.percent)
    ? progress.percent
    : progress?.progress;

  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function loadingStage(progress) {
  const embedding = progress?.pipeline === "feature-extraction";
  const start = 10;
  const span = embedding ? 24 : 35;

  return {
    label: embedding ? "LOADING EMBEDDING MODEL" : "LOADING SYNTHESIS MODEL",
    percent: start + (reportedPercent(progress) / 100) * span,
    rank: 3,
  };
}

function generationStage(progress) {
  return {
    label: "WRITING SYNTHESIS",
    percent: 48 + (reportedPercent(progress) / 100) * 46,
    rank: 4,
  };
}

export function analysisProgressView(progress, previous = initialAnalysisProgress()) {
  const stage = String(progress?.stage || "");
  let next = STAGES[stage] || {
    label: "ANALYZING LOCALLY",
    percent: 10,
    rank: 2,
  };

  if (stage === "loading") next = loadingStage(progress);
  if (stage === "generating") next = generationStage(progress);

  if (Number.isFinite(progress?.overallPercent)) {
    next = {
      ...next,
      percent: Math.max(0, Math.min(100, progress.overallPercent)),
    };
  }

  if (next.rank < previous.rank) return previous;

  return {
    label: next.label,
    percent: Math.max(previous.percent, Math.round(next.percent)),
    rank: next.rank,
  };
}
