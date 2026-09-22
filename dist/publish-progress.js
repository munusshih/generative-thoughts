function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function publishImagePercent(completed, total) {
  const progress = clamp(Number(completed) / Math.max(1, Number(total)), 0, 1);
  return Math.round(5 + progress * 30);
}

export function publishVideoPercent(index, progress, total) {
  const safeTotal = Math.max(1, Number(total));
  const completed = clamp(Number(index) + clamp(Number(progress), 0, 1), 0, safeTotal);
  return Math.round(35 + (completed / safeTotal) * 50);
}
