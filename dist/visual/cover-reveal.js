function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  row,
  col,
  rows,
  cols,
}) {
  const safeRows = Math.max(1, Math.floor(Number(rows) || 0));
  const safeCols = Math.max(1, Math.floor(Number(cols) || 0));
  const safeRow = clamp(Math.floor(Number(row) || 0), 0, safeRows - 1);
  const safeCol = clamp(Math.floor(Number(col) || 0), 0, safeCols - 1);
  const cellIndex = safeRow * safeCols + safeCol + 1;

  return cellIndex / (safeRows * safeCols);
}
