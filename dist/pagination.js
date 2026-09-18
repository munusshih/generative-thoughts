import { LAYOUT, PRINT_FONT, TYPE } from "./config.js";

function wrapPhysicalLine(graphics, sourceLine, maxWidth) {
  if (sourceLine === "") return [""];

  const words = sourceLine.split(/([ \t]+)/).filter((part) => part.length);
  const lines = [];
  let current = "";

  for (const part of words) {
    const candidate = current + part;

    if (!current || graphics.textWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current.replace(/[ \t]+$/g, ""));
    current = part.replace(/^[ \t]+/g, "");

    // Very long unbroken strings still need to wrap.
    while (current && graphics.textWidth(current) > maxWidth) {
      let cut = current.length - 1;
      while (cut > 1 && graphics.textWidth(current.slice(0, cut)) > maxWidth) {
        cut -= 1;
      }
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }

  lines.push(current.replace(/[ \t]+$/g, ""));
  return lines;
}

export function paginateText(graphics, text) {
  if (!graphics || !String(text || "").length) return [];

  graphics.push();
  graphics.textFont(PRINT_FONT);
  graphics.textStyle(graphics.NORMAL);
  graphics.textSize(TYPE.size);

  const lineHeight = TYPE.size * TYPE.leading;
  const maxLines = Math.max(1, Math.floor(LAYOUT.height / lineHeight));

  // A literal newline in the editor is a literal line break in the publication.
  const physicalLines = String(text).replace(/\r\n/g, "\n").split("\n");
  const composed = [];

  for (const physicalLine of physicalLines) {
    composed.push(...wrapPhysicalLine(graphics, physicalLine, LAYOUT.width));
  }

  const pages = [];
  for (let cursor = 0; cursor < composed.length; cursor += maxLines) {
    pages.push({
      type: "text",
      lines: composed.slice(cursor, cursor + maxLines),
      lineHeight,
    });
  }

  graphics.pop();
  return pages;
}
