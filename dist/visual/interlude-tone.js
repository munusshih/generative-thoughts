const GLYPHS = [".", ":", "*", "o", "O", "0", "8", "#"];

const SOLID_GREYS = [
  "#b4b4b4",
  "#9a9a9a",
  "#808080",
  "#666666",
  "#4c4c4c",
  "#343434",
  "#1c1c1c",
  "#080808",
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function interludeTextCell(tone) {
  const normalized = clamp((Number(tone) - 0.04) / 0.96, 0, 1);

  if (normalized <= 0.025) return null;

  const shaped = Math.pow(normalized, 0.82);
  const index = clamp(
    Math.floor(shaped * GLYPHS.length),
    0,
    GLYPHS.length - 1,
  );

  return {
    glyph: GLYPHS[index],
    color: SOLID_GREYS[index],
  };
}
