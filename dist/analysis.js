import {
  analyzeText,
  extractRecurringTerms,
  formatDuration,
  formatTimestamp,
} from "./helpers.js";

export function buildSynthesis(state) {
  return {
    timestamp: formatTimestamp(state.updatedAt || state.createdAt),
    typingTime: formatDuration(state.typing?.activeMs || 0),
    features: analyzeText(state.text),
    lexicalTerms: extractRecurringTerms(state.text, 5),
    machine: state.machineAnalysis,
  };
}
