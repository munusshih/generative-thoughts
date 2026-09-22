const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cellJitter(seed, row, col) {
  let value =
    (Number(seed || 0) >>> 0) ^
    Math.imul(row + 1, 0x9e3779b1) ^
    Math.imul(col + 1, 0x85ebca77);

  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;

  return (value >>> 0) / 0xffffffff;
}

export function coverVisualRevealProgress({
  visibleCharacters,
  labelLength,
  titleLength,
}) {
  const titleStart = Math.max(0, Number(labelLength) || 0) + 1;
  const safeTitleLength = Math.max(1, Number(titleLength) || 0);

  return clamp(
    ((Number(visibleCharacters) || 0) - titleStart) / safeTitleLength,
    0,
    1,
  );
}

export function coverVisualCellThreshold({
  x,
  y,
  row,
  col,
  seed,
  phase = 0,
}) {
  const angle =
    (Math.atan2(Number(y) || 0, Number(x) || 0) + Math.PI) / TAU;
  const phaseTurns = ((Number(phase) || 0) / TAU) % 1;
  const orbitalSweep = (angle + phaseTurns + 1) % 1;
  const radialSweep = clamp(Math.hypot(Number(x) || 0, Number(y) || 0), 0, 1);
  const stagger = cellJitter(seed, row, col);

  return clamp(
    orbitalSweep * 0.76 + radialSweep * 0.16 + stagger * 0.08,
    0,
    1,
  );
}
