const CHARACTERS_PER_SECOND = 34;
const MIN_TYPING_MS = 2500;
const MAX_VIDEO_MS = 20_000;
const ENCODER_MARGIN_MS = 400;
const START_HOLD_MS = 350;
const COVER_END_HOLD_MS = 800;
const SYNTHESIS_END_HOLD_MS = 5000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function publicationVideoTiming({ type, totalCharacters }) {
  const endHoldMs =
    type === "synthesis" ? SYNTHESIS_END_HOLD_MS : COVER_END_HOLD_MS;
  const maximumTimelineMs = MAX_VIDEO_MS - ENCODER_MARGIN_MS;
  const maximumTypingMs = maximumTimelineMs - START_HOLD_MS - endHoldMs;
  const requestedTypingMs =
    (Math.max(1, Number(totalCharacters) || 0) / CHARACTERS_PER_SECOND) * 1000;
  const typingMs = clamp(requestedTypingMs, MIN_TYPING_MS, maximumTypingMs);

  return {
    startHoldMs: START_HOLD_MS,
    typingMs,
    endHoldMs,
    totalMs: START_HOLD_MS + typingMs + endHoldMs,
  };
}
