import { LAYOUT, PRINT_FONT, TYPE } from "./config.js";

import { analyzeText, clamp, lerp, pad, stringSeed } from "./helpers.js";
import { evaluateImageField, getShapeImage } from "./visual/image-field.js";

const TAU = Math.PI * 2;

/* =========================================================
   PAGE
   ========================================================= */

const MARGIN_X_RATIO = 0.08;

const MARGIN_Y_RATIO = 0.065;

/*
  Backgrounds are intentionally very close.

  The first neutral paper is weighted heavily below,
  so the publication does not constantly change color.
*/

const THEMES = [
  {
    background: "#f1ede3",
    text: "#35312c",
    art: "#171512",
    dim: "#978f84",
  },

  {
    background: "#efebe3",
    text: "#394039",
    art: "#191d19",
    dim: "#929a93",
  },

  {
    background: "#f0ece7",
    text: "#443d40",
    art: "#211d1f",
    dim: "#9a9294",
  },

  {
    background: "#ecefe9",
    text: "#394139",
    art: "#192019",
    dim: "#909890",
  },
];

/*
  Weighted theme selection.

  0 appears much more often.

  Even when "New visual" changes visualSeed,
  the background often stays the same.
*/

const THEME_WEIGHTS = [0, 0, 0, 0, 0, 1, 1, 2, 3];

/* =========================================================
   SYMBOL RAMPS
   ========================================================= */

const SYMBOL_RAMPS = [
  {
    name: "dot-star",
    glyphs: [".", "·", ":", "*", "•", "●"],
  },

  {
    name: "star-circle",
    glyphs: [".", "·", "*", "°", "○", "●"],
  },

  {
    name: "cross",
    glyphs: [".", ":", "+", "×", "*", "●"],
  },

  {
    name: "circle",
    glyphs: [".", "·", "°", "○", "◉", "●"],
  },

  {
    name: "diamond",
    glyphs: [".", ":", "*", "◇", "◆", "●"],
  },

  {
    name: "triangle-up",
    glyphs: [".", "·", "^", "*", "△", "▲"],
  },

  {
    name: "triangle-down",
    glyphs: [".", "·", ":", "*", "▽", "▼"],
  },

  {
    name: "slash",
    glyphs: [".", "·", "/", "*", "+", "●"],
  },

  {
    name: "backslash",
    glyphs: [".", "·", "\\", "*", "+", "●"],
  },

  {
    name: "vertical",
    glyphs: [".", ":", "|", "*", "+", "●"],
  },

  {
    name: "horizontal",
    glyphs: [".", "·", "-", "=", "*", "●"],
  },

  {
    name: "punctuation",
    glyphs: [".", "·", ":", ";", "*", "●"],
  },

  {
    name: "geometric",
    glyphs: [".", ":", "*", "○", "◇", "◆"],
  },

  {
    name: "mixed",
    glyphs: [".", "·", "+", "*", "○", "●"],
  },
];

/* =========================================================
   TITLE POSITIONS
   ========================================================= */

const TITLE_LAYOUTS = [
  {
    x: 0.0,
    y: 0.08,
    w: 0.62,
  },

  {
    x: 0.38,
    y: 0.09,
    w: 0.62,
  },

  {
    x: 0.02,
    y: 0.25,
    w: 0.6,
  },

  {
    x: 0.0,
    y: 0.43,
    w: 0.62,
  },

  {
    x: 0.38,
    y: 0.44,
    w: 0.62,
  },

  {
    x: 0.0,
    y: 0.73,
    w: 0.66,
  },

  {
    x: 0.34,
    y: 0.75,
    w: 0.66,
  },

  {
    x: 0.0,
    y: 0.86,
    w: 1.0,
  },
];

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function activeNumber(state) {
  return state.currentIndex || null;
}

function publishRevealForSlide(state, index) {
  const reveal = state.__publishReveal || null;

  if (!reveal || !reveal.active || reveal.slideIndex !== index) {
    return null;
  }

  return reveal;
}

function lineCharacterCount(lines) {
  const safeLines = Array.isArray(lines) ? lines : [];

  return safeLines.reduce(
    (total, line, index) =>
      total +
      String(line || "").length +
      (index < safeLines.length - 1 ? 1 : 0),
    0,
  );
}

function revealLinesByCharacters(lines, visibleCharacters) {
  const safeLines = Array.isArray(lines) ? lines : [];

  let remaining = Math.max(0, Math.floor(Number(visibleCharacters) || 0));

  const output = [];

  for (let index = 0; index < safeLines.length; index += 1) {
    const line = String(safeLines[index] || "");

    if (remaining <= 0) {
      break;
    }

    if (line.length) {
      const amount = Math.min(remaining, line.length);

      output.push(line.slice(0, amount));

      remaining -= amount;

      if (amount < line.length) {
        break;
      }
    } else {
      output.push("");
    }

    if (index < safeLines.length - 1) {
      if (remaining <= 0) {
        break;
      }

      remaining -= 1;
    }
  }

  return output;
}

function seededRandom(seed) {
  let a = seed >>> 0;

  return () => {
    a |= 0;

    a = (a + 0x6d2b79f5) | 0;

    let t = Math.imul(
      a ^ (a >>> 15),

      1 | a,
    );

    t =
      (t +
        Math.imul(
          t ^ (t >>> 7),

          61 | t,
        )) ^
      t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rotate(x, y, angle) {
  const c = Math.cos(angle);

  const s = Math.sin(angle);

  return {
    x: x * c - y * s,

    y: x * s + y * c,
  };
}

function smoothstep(a, b, value) {
  const t = clamp(
    (value - a) /
      Math.max(
        0.000001,

        b - a,
      ),

    0,
    1,
  );

  return t * t * (3 - 2 * t);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;

  const vy = by - ay;

  const wx = px - ax;

  const wy = py - ay;

  const c1 = vx * wx + vy * wy;

  if (c1 <= 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const c2 = vx * vx + vy * vy;

  if (c2 <= c1) {
    return Math.hypot(px - bx, py - by);
  }

  const t = c1 / c2;

  return Math.hypot(
    px - (ax + vx * t),

    py - (ay + vy * t),
  );
}

function normalizePoints(points, scale = 0.92) {
  if (!points.length) {
    return points;
  }

  let minX = Infinity;

  let minY = Infinity;

  let maxX = -Infinity;

  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);

    minY = Math.min(minY, point.y);

    maxX = Math.max(maxX, point.x);

    maxY = Math.max(maxY, point.y);
  }

  const width = Math.max(
    0.0001,

    maxX - minX,
  );

  const height = Math.max(
    0.0001,

    maxY - minY,
  );

  const s = (2 * scale) / Math.max(width, height);

  const cx = (minX + maxX) / 2;

  const cy = (minY + maxY) / 2;

  return points.map((point) => ({
    x: (point.x - cx) * s,

    y: (point.y - cy) * s,
  }));
}

/* =========================================================
   TEXT FEATURES
   ========================================================= */

function makeFeatureVector(state) {
  const raw = analyzeText(`${state.title}\n${state.text}`);

  return {
    raw,

    seed: stringSeed(`${state.title}|${state.text}|${state.visualSeed}`),

    length: clamp(
      Math.log1p(raw.words || 0) / Math.log(900),

      0,
      1,
    ),

    punctuation: clamp(
      ((raw.punctuation || 0) /
        Math.max(
          1,

          raw.words || 0,
        )) *
        4.5,

      0,
      1,
    ),

    paragraphing: clamp(
      (raw.paragraphs || 0) / 14,

      0,
      1,
    ),

    sentenceVariance: clamp(
      Math.sqrt(raw.sentenceVariance || 0) / 22,

      0,
      1,
    ),

    lexical: clamp(
      raw.lexicalDensity || 0,

      0,
      1,
    ),

    repetition: clamp(
      (raw.repetition || 0) * 2.2,

      0,
      1,
    ),

    questions: clamp(
      (raw.questions || 0) / 5,

      0,
      1,
    ),

    breaks: clamp(
      (raw.lineBreaks || 0) / 18,

      0,
      1,
    ),
  };
}

/* =========================================================
   GRID
   ========================================================= */

function getGrid(graphics) {
  const width = graphics?.width || LAYOUT.right || 800;

  const height = graphics?.height || LAYOUT.bottom || 1000;

  const left = width * MARGIN_X_RATIO;

  const top = height * MARGIN_Y_RATIO;

  const usableWidth = width - left * 2;

  const usableHeight = height - top * 2;

  const fontSize = TYPE.size || 13;

  graphics.push();

  graphics.textFont(PRINT_FONT);

  graphics.textStyle(graphics.NORMAL);

  graphics.textSize(fontSize);

  const cellWidth = Math.max(
    1,

    graphics.textWidth("________________________________________") / 40,
  );

  graphics.pop();

  const cellHeight = fontSize * 1.08;

  const cols = Math.max(
    1,

    Math.floor(usableWidth / cellWidth),
  );

  const rows = Math.max(
    1,

    Math.floor(usableHeight / cellHeight),
  );

  return {
    left,
    top,

    cols,
    rows,

    cellWidth,
    cellHeight,

    fontSize,

    width: cols * cellWidth,

    height: rows * cellHeight,
  };
}

function rowBaseline(grid, row) {
  return grid.top + row * grid.cellHeight + grid.cellHeight * 0.82;
}

function fractionToCol(grid, value) {
  return clamp(
    Math.round(value * (grid.cols - 1)),

    0,

    grid.cols - 1,
  );
}

function fractionToRow(grid, value) {
  return clamp(
    Math.round(value * (grid.rows - 1)),

    0,

    grid.rows - 1,
  );
}

/* =========================================================
   BACKGROUND TEXTURE
   ========================================================= */

function drawBackgroundTexture(graphics, state) {
  const theme = getThemeForState(state);

  const seed = Number(state.visualSeed || 1) ^ 0x72a91b;

  const random = seededRandom(seed);

  graphics.push();

  graphics.noFill();

  const textureColor = graphics.color(theme.text);

  textureColor.setAlpha(10);

  graphics.stroke(textureColor);

  graphics.strokeWeight(0.55);

  const fibers = Math.round((graphics.width * graphics.height) / 4200);

  for (let index = 0; index < fibers; index += 1) {
    const x = random() * graphics.width;

    const y = random() * graphics.height;

    const length = 0.6 + random() * 2.2;

    if (random() < 0.55) {
      graphics.line(x, y, x + length, y);
    } else {
      graphics.line(x, y, x, y + length);
    }
  }

  const grainColor = graphics.color(theme.text);

  grainColor.setAlpha(7);

  graphics.stroke(grainColor);

  graphics.strokeWeight(0.7);

  const grains = Math.round((graphics.width * graphics.height) / 7000);

  for (let index = 0; index < grains; index += 1) {
    graphics.point(
      random() * graphics.width,

      random() * graphics.height,
    );
  }

  graphics.pop();
}

/* =========================================================
   BUFFER
   ========================================================= */

function createBuffer(grid, char = " ", kind = "text") {
  return Array.from(
    {
      length: grid.rows,
    },

    () =>
      Array.from(
        {
          length: grid.cols,
        },

        () => ({
          char,
          kind,
        }),
      ),
  );
}

function createCoverBuffer(grid) {
  return createBuffer(grid, "_", "blank");
}

function setCell(buffer, row, col, char, kind) {
  if (row < 0 || row >= buffer.length) {
    return;
  }

  if (col < 0 || col >= buffer[row].length) {
    return;
  }

  buffer[row][col] = {
    char,
    kind,
  };
}

/* =========================================================
   TEXT
   ========================================================= */

function wrapToColumns(value, width) {
  const sourceText = String(value || "").trim();

  if (!sourceText) {
    return [];
  }

  const output = [];

  for (const paragraph of sourceText.split(/\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);

    if (!words.length) {
      output.push("");

      continue;
    }

    let line = "";

    for (const word of words) {
      const next = line ? `${line} ${word}` : word;

      if (!line || next.length <= width) {
        line = next;
      } else {
        output.push(line);

        line = word;
      }
    }

    if (line) {
      output.push(line);
    }
  }

  return output;
}

function writeString(buffer, row, col, value) {
  if (row < 0 || row >= buffer.length) {
    return;
  }

  const sourceText = String(value || "");

  for (let index = 0; index < sourceText.length; index += 1) {
    const target = col + index;

    if (target >= 0 && target < buffer[row].length) {
      setCell(buffer, row, target, sourceText[index], "text");
    }
  }
}

function writePreciseTextBlock(
  buffer,
  value,
  row,
  col,
  width,
  maxLines = 3,
  rowStep = 2,
) {
  const lines = wrapToColumns(value, width).slice(0, maxLines);

  lines.forEach((line, index) => {
    writeString(
      buffer,

      row + index * rowStep,

      col,

      line,
    );
  });
}

/* =========================================================
   CURVES
   ========================================================= */

function curveDistance(points, x, y) {
  let nearest = Infinity;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];

    const b = points[index];

    nearest = Math.min(
      nearest,

      distToSegment(x, y, a.x, a.y, b.x, b.y),
    );
  }

  return nearest;
}

function makeLissajousCurve(random, features) {
  const choices = [2, 3, 4, 5, 7];

  let a = choices[Math.floor(random() * choices.length)];

  let b = choices[Math.floor(random() * choices.length)];

  if (a === b) {
    b = choices[(choices.indexOf(b) + 1) % choices.length];
  }

  const phase = random() * TAU;

  const points = [];

  for (let index = 0; index <= 280; index += 1) {
    const t = (index / 280) * TAU;

    points.push({
      x: Math.sin(a * t + phase) * (0.78 + features.sentenceVariance * 0.12),

      y: Math.sin(b * t) * (0.78 + features.paragraphing * 0.12),
    });
  }

  return normalizePoints(points, 0.91);
}

function makeHarmonographCurve(random, features) {
  const points = [];

  const frequencies = Array.from(
    {
      length: 4,
    },

    () => 1.5 + random() * 2.2,
  );

  const phases = Array.from(
    {
      length: 4,
    },

    () => random() * TAU,
  );

  const damping = 0.038 + features.length * 0.034;

  for (let index = 0; index <= 340; index += 1) {
    const t = (index / 340) * 16;

    const d = Math.exp(-damping * t);

    points.push({
      x:
        (Math.sin(frequencies[0] * t + phases[0]) * 0.55 +
          Math.sin(frequencies[1] * t + phases[1]) * 0.45) *
        d,

      y:
        (Math.sin(frequencies[2] * t + phases[2]) * 0.55 +
          Math.sin(frequencies[3] * t + phases[3]) * 0.45) *
        d,
    });
  }

  return normalizePoints(points, 0.92);
}

/* =========================================================
   SUPERFORMULA
   ========================================================= */

function superformulaRadius(angle, params) {
  const a = Math.pow(
    Math.abs(Math.cos((params.m * angle) / 4)),

    params.n2,
  );

  const b = Math.pow(
    Math.abs(Math.sin((params.m * angle) / 4)),

    params.n3,
  );

  if (a + b <= 0.000001) {
    return 0;
  }

  return Math.pow(
    a + b,

    -1 / params.n1,
  );
}

/* =========================================================
   MATHEMATICAL SYSTEM
   ========================================================= */

function createMathSystem(random, features) {
  const familyChoices = [
    "superformula",
    "superformula",
    "rose",
    "lissajous",
    "harmonograph",
    "interference",
  ];

  const symmetryChoices = [3, 4, 5, 6, 7, 8, 10, 12];

  const family = familyChoices[Math.floor(random() * familyChoices.length)];

  const symmetry =
    symmetryChoices[Math.floor(random() * symmetryChoices.length)];

  const common = {
    family,

    rotation: (random() - 0.5) * TAU,

    scaleX: 0.76 + random() * 0.38,

    scaleY: 0.76 + random() * 0.38,

    phase: random() * TAU,

    bandFrequency: 4.5 + random() * (5 + features.punctuation * 7),

    bandTwist: 1 + random() * (2 + features.sentenceVariance * 4),

    waveX: 2.5 + random() * 5,

    waveY: 2.5 + random() * 5,
  };

  if (family === "superformula") {
    return {
      ...common,

      m: symmetry,

      n1: 0.3 + random() * (1.1 + features.lexical * 1.25),

      n2: 0.45 + random() * 2.3,

      n3: 0.45 + random() * 2.3,

      radius: 0.72 + random() * 0.16,

      softness: 0.1 + random() * 0.07,
    };
  }

  if (family === "rose") {
    return {
      ...common,

      petals: symmetry,

      radius: 0.7 + random() * 0.16,

      petalDepth: 0.2 + random() * 0.22,

      softness: 0.1 + random() * 0.07,
    };
  }

  if (family === "lissajous" || family === "harmonograph") {
    return {
      ...common,

      curve:
        family === "lissajous"
          ? makeLissajousCurve(random, features)
          : makeHarmonographCurve(random, features),

      thickness: (family === "lissajous" ? 0.028 : 0.026) + random() * 0.035,

      echoGap: 0.07 + random() * 0.055,

      echoStrength: 0.32 + random() * 0.28,
    };
  }

  return {
    ...common,

    sourceA: {
      x: -0.32 + random() * 0.14,

      y: (random() - 0.5) * 0.3,
    },

    sourceB: {
      x: 0.32 - random() * 0.14,

      y: (random() - 0.5) * 0.3,
    },

    sourceC: {
      x: (random() - 0.5) * 0.2,

      y: 0.28 + random() * 0.12,
    },

    sourceCount: random() < 0.45 ? 3 : 2,

    frequency: 7 + random() * (5 + features.breaks * 6),

    envelopeX: 0.82 + random() * 0.16,

    envelopeY: 0.78 + random() * 0.18,

    envelopePower: 1.8 + random() * 2.8,
  };
}

/* =========================================================
   MATHEMATICAL FIELD
   ========================================================= */

function evaluateMathField(math, x, y) {
  const point = rotate(x, y, math.rotation);

  const px = point.x / math.scaleX;

  const py = point.y / math.scaleY;

  const radius = Math.hypot(px, py);

  const angle = Math.atan2(py, px);

  if (math.family === "superformula") {
    const target = superformulaRadius(angle, math) * math.radius;

    const interior = smoothstep(
      -math.softness,
      math.softness,

      target - radius,
    );

    if (interior <= 0.001) {
      return 0;
    }

    const bands =
      0.5 +
      0.5 *
        Math.sin(
          radius * math.bandFrequency * 10 +
            angle * math.bandTwist +
            math.phase,
        );

    const wave =
      0.5 +
      0.5 * Math.sin(px * math.waveX * 4 + Math.sin(py * math.waveY * 3) * 1.4);

    return clamp(
      interior * (Math.pow(bands, 1.5) * 0.64 + Math.pow(wave, 1.7) * 0.36),

      0,
      1,
    );
  }

  if (math.family === "rose") {
    const petal = Math.abs(Math.cos((angle * math.petals) / 2 + math.phase));

    const target =
      math.radius * (1 - math.petalDepth + petal * math.petalDepth);

    const interior = smoothstep(
      -math.softness,
      math.softness,

      target - radius,
    );

    if (interior <= 0.001) {
      return 0;
    }

    const radial =
      0.5 +
      0.5 *
        Math.sin(
          radius * math.bandFrequency * 11 -
            angle * math.bandTwist +
            math.phase,
        );

    const angular =
      0.5 + 0.5 * Math.cos(angle * math.petals * 2 + radius * math.waveX * 3);

    return clamp(
      interior * (Math.pow(radial, 1.5) * 0.67 + Math.pow(angular, 1.8) * 0.33),

      0,
      1,
    );
  }

  if (math.family === "lissajous" || math.family === "harmonograph") {
    const distance = curveDistance(math.curve, px, py);

    const main = clamp(
      1 - distance / math.thickness,

      0,
      1,
    );

    const echo =
      clamp(
        1 - Math.abs(distance - math.echoGap) / (math.thickness * 0.65),

        0,
        1,
      ) * math.echoStrength;

    return Math.max(main, echo);
  }

  const envelope = clamp(
    1 -
      (Math.pow(
        Math.abs(px / math.envelopeX),

        math.envelopePower,
      ) +
        Math.pow(
          Math.abs(py / math.envelopeY),

          math.envelopePower,
        )),

    0,
    1,
  );

  if (envelope <= 0.001) {
    return 0;
  }

  const d1 = Math.hypot(
    px - math.sourceA.x,

    py - math.sourceA.y,
  );

  const d2 = Math.hypot(
    px - math.sourceB.x,

    py - math.sourceB.y,
  );

  let signal =
    Math.sin(d1 * math.frequency + math.phase) +
    Math.sin(d2 * math.frequency - math.phase);

  let divisor = 2;

  if (math.sourceCount === 3) {
    const d3 = Math.hypot(
      px - math.sourceC.x,

      py - math.sourceC.y,
    );

    signal += Math.sin(d3 * math.frequency * 0.86 + math.phase * 0.5);

    divisor = 3;
  }

  const normalized = clamp(
    (signal / divisor) * 0.5 + 0.5,

    0,
    1,
  );

  return clamp(
    envelope * Math.pow(normalized, 1.7),

    0,
    1,
  );
}

/* =========================================================
   STRUCTURED NEGATIVE SPACE
   ========================================================= */

function createSpacingSystem(random, features) {
  const modes = ["waves", "waves", "radial", "diagonal", "cross"];

  return {
    mode: modes[Math.floor(random() * modes.length)],

    rotation: (random() - 0.5) * TAU,

    frequency: 3.2 + random() * (2.6 + features.punctuation * 2.2),

    secondaryFrequency: 1.8 + random() * 3,

    warp: 0.35 + random() * 1.15,

    phase: random() * TAU,

    cut: 0.34 + random() * 0.17,
  };
}

function evaluateSpacingField(spacing, x, y) {
  const point = rotate(x, y, spacing.rotation);

  let value;

  if (spacing.mode === "radial") {
    value =
      0.5 +
      0.5 *
        Math.sin(
          Math.hypot(point.x, point.y) * spacing.frequency * 10 +
            Math.sin(
              Math.atan2(point.y, point.x) * spacing.secondaryFrequency,
            ) *
              spacing.warp +
            spacing.phase,
        );
  } else if (spacing.mode === "diagonal") {
    value =
      0.5 +
      0.5 *
        Math.sin(
          (point.x + point.y) * spacing.frequency * 5 +
            Math.sin((point.x - point.y) * spacing.secondaryFrequency * 3) *
              spacing.warp +
            spacing.phase,
        );
  } else if (spacing.mode === "cross") {
    const a =
      0.5 + 0.5 * Math.sin(point.x * spacing.frequency * 5 + spacing.phase);

    const b =
      0.5 +
      0.5 * Math.sin(point.y * spacing.secondaryFrequency * 6 - spacing.phase);

    value = a * 0.58 + b * 0.42;
  } else {
    value =
      0.5 +
      0.5 *
        Math.sin(
          point.y * spacing.frequency * 5 +
            Math.sin(point.x * spacing.secondaryFrequency * 4) * spacing.warp +
            spacing.phase,
        );
  }

  return smoothstep(spacing.cut, 1, value);
}

/* =========================================================
   LARGE PAGE-SCALE PLACEMENT
   ========================================================= */

function chooseVisualPlacement(random, titleLayout) {
  const titleCenter = titleLayout.x + titleLayout.w / 2;

  const awayX = titleCenter < 0.5 ? 0.12 : -0.12;

  const awayY = titleLayout.y < 0.45 ? 0.08 : -0.09;

  const modes = [
    "large",
    "large",
    "large",
    "full",
    "landscape",
    "vertical",
    "crop-left",
    "crop-right",
  ];

  const mode = modes[Math.floor(random() * modes.length)];

  if (mode === "full") {
    return {
      x: (random() - 0.5) * 0.08,

      y: (random() - 0.5) * 0.08,

      sx: 1.28 + random() * 0.18,

      sy: 1.24 + random() * 0.2,

      rotation: (random() - 0.5) * 0.1,
    };
  }

  if (mode === "landscape") {
    return {
      x: awayX * 0.3,

      y: awayY,

      sx: 1.42 + random() * 0.18,

      sy: 0.78 + random() * 0.15,

      rotation: (random() - 0.5) * 0.1,
    };
  }

  if (mode === "vertical") {
    return {
      x: awayX,

      y: awayY * 0.4,

      sx: 0.78 + random() * 0.15,

      sy: 1.42 + random() * 0.18,

      rotation: (random() - 0.5) * 0.1,
    };
  }

  if (mode === "crop-left") {
    return {
      x: -0.5 - random() * 0.08,

      y: awayY * 0.3,

      sx: 1.42 + random() * 0.22,

      sy: 1.14 + random() * 0.2,

      rotation: (random() - 0.5) * 0.12,
    };
  }

  if (mode === "crop-right") {
    return {
      x: 0.5 + random() * 0.08,

      y: awayY * 0.3,

      sx: 1.42 + random() * 0.22,

      sy: 1.14 + random() * 0.2,

      rotation: (random() - 0.5) * 0.12,
    };
  }

  return {
    x: awayX + (random() - 0.5) * 0.08,

    y: awayY + (random() - 0.5) * 0.08,

    sx: 1.05 + random() * 0.22,

    sy: 1.02 + random() * 0.24,

    rotation: (random() - 0.5) * 0.12,
  };
}

/* =========================================================
   STABLE THEME
   ========================================================= */

function themeIndexForState(state) {
  const seed = Number(state.visualSeed || 1) >>> 0;

  const random = seededRandom(seed ^ 0x9e719b);

  const choice = THEME_WEIGHTS[Math.floor(random() * THEME_WEIGHTS.length)];

  return choice % THEMES.length;
}

/* =========================================================
   VISUAL SYSTEM
   ========================================================= */

function createVisualSystem(state) {
  const features = makeFeatureVector(state);

  const random = seededRandom(
    features.seed ^ Number(state.visualSeed || 0) ^ 0x53a9b27d,
  );

  const titleLayout =
    TITLE_LAYOUTS[Math.floor(random() * TITLE_LAYOUTS.length)];

  return {
    features,

    titleLayout,

    ramp: SYMBOL_RAMPS[Math.floor(random() * SYMBOL_RAMPS.length)],

    math: createMathSystem(random, features),

    spacing: createSpacingSystem(random, features),

    threshold: clamp(
      0.25 + features.breaks * 0.025 - features.length * 0.015,

      0.22,
      0.31,
    ),

    rampGamma: clamp(
      lerp(
        1.18,
        0.74,

        features.lexical * 0.65 + features.length * 0.35,
      ),

      0.7,
      1.22,
    ),

    placement: chooseVisualPlacement(random, titleLayout),

    themeIndex: themeIndexForState(state),
  };
}

function getVisualSystem(state) {
  const image = getShapeImage(state);

  const key = `${state.title}|${state.text}|${state.visualSeed}`;

  if (
    state.__visualKey !== key ||
    !state.__visualSystem ||
    state.__visualImageRef !== image
  ) {
    state.__visualSystem = createVisualSystem(state);

    state.__visualKey = key;

    state.__visualImageRef = image;
  }

  return state.__visualSystem;
}

/* =========================================================
   THEME EXPORTS
   ========================================================= */

export function getThemeForState(state) {
  return THEMES[themeIndexForState(state)];
}

export function applyThemeToDocument(state) {
  const theme = getThemeForState(state);

  const root = document.documentElement;

  root.style.setProperty("--bg", theme.background);

  root.style.setProperty("--text", theme.text);

  root.style.setProperty("--dim", theme.dim);

  root.style.setProperty("--outline", `${theme.text}22`);
}

/* =========================================================
   VISUAL VALUE
   ========================================================= */

function visualValue(system, state, nx, ny) {
  const placement = system.placement;

  const local = rotate(
    (nx - placement.x) / placement.sx,

    (ny - placement.y) / placement.sy,

    placement.rotation,
  );

  const mathValue = evaluateMathField(system.math, local.x, local.y);

  const imageValue = evaluateImageField(state, local.x, local.y);

  const source =
    imageValue === null
      ? mathValue
      : clamp(
          imageValue * 0.87 + mathValue * 0.13,

          0,
          1,
        );

  if (
    system.math.family === "lissajous" ||
    system.math.family === "harmonograph"
  ) {
    return source;
  }

  const spacing = evaluateSpacingField(system.spacing, local.x, local.y);

  return clamp(
    source * (0.12 + spacing * 0.88),

    0,
    1,
  );
}

/* =========================================================
   VALUE TO SYMBOL
   ========================================================= */

function glyphFromValue(system, value) {
  if (value <= system.threshold) {
    return null;
  }

  const normalized = clamp(
    (value - system.threshold) /
      Math.max(
        0.0001,

        1 - system.threshold,
      ),

    0,
    1,
  );

  const shaped = Math.pow(normalized, system.rampGamma);

  const ramp = system.ramp.glyphs;

  const index = clamp(
    Math.floor(shaped * ramp.length),

    0,

    ramp.length - 1,
  );

  return ramp[index];
}

/* =========================================================
   WRITE VISUAL
   ========================================================= */

function writeVisual(buffer, grid, state) {
  const system = getVisualSystem(state);

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const nx =
        (col /
          Math.max(
            1,

            grid.cols - 1,
          ) -
          0.5) *
        2;

      const ny =
        (row /
          Math.max(
            1,

            grid.rows - 1,
          ) -
          0.5) *
        2;

      const value = visualValue(system, state, nx, ny);

      const glyph = glyphFromValue(system, value);

      if (glyph !== null) {
        setCell(buffer, row, col, glyph, "art");
      }
    }
  }
}

/* =========================================================
   COVER TEXT
   ========================================================= */

function writeCoverText(buffer, grid, state, slideIndex = 0) {
  const system = getVisualSystem(state);

  const title = String(state.title || "Untitled").trim();

  const number = activeNumber(state);

  const label = number
    ? `generative thoughts #${pad(number)}`
    : "generative thoughts";

  const layout = system.titleLayout;

  const row = fractionToRow(grid, layout.y);

  const col = fractionToCol(grid, layout.x);

  const width = Math.max(
    18,

    Math.min(
      grid.cols - col,

      Math.round(grid.cols * layout.w),
    ),
  );

  const reveal = publishRevealForSlide(state, slideIndex);

  if (!reveal) {
    writeString(buffer, row, col, label);

    writePreciseTextBlock(
      buffer,
      title,

      row + 2,

      col,

      width,

      3,

      2,
    );

    return;
  }

  let remaining = Math.max(
    0,
    Math.floor(Number(reveal.visibleCharacters) || 0),
  );

  const visibleLabel = label.slice(0, remaining);

  writeString(buffer, row, col, visibleLabel);

  remaining -= visibleLabel.length;

  if (visibleLabel.length < label.length || remaining <= 0) {
    return;
  }

  /*
    Count the conceptual line break between
    the publication label and title as one
    typing character.
  */

  remaining -= 1;

  if (remaining < 0) {
    return;
  }

  /*
    Wrap from the FINAL title instead of the
    partial title. This keeps line breaks fixed
    while characters appear and prevents the
    title from jumping between lines as it types.
  */

  const titleLines = wrapToColumns(title, width).slice(0, 3);

  const visibleTitleLines = revealLinesByCharacters(titleLines, remaining);

  visibleTitleLines.forEach((line, index) => {
    writeString(
      buffer,

      row + 2 + index * 2,

      col,

      line,
    );
  });
}

/* =========================================================
   COVER RENDERER
   ========================================================= */

function renderBuffer(graphics, grid, buffer, theme) {
  graphics.push();

  graphics.noStroke();

  graphics.textFont(PRINT_FONT);

  graphics.textStyle(graphics.NORMAL);

  graphics.textSize(grid.fontSize);

  graphics.textAlign(graphics.LEFT, graphics.BASELINE);

  for (let row = 0; row < grid.rows; row += 1) {
    let runKind = null;

    let runText = "";

    let runStart = 0;

    const flush = () => {
      if (runKind === null || !runText.length) {
        return;
      }

      graphics.fill(
        runKind === "blank"
          ? theme.dim
          : runKind === "art"
            ? theme.art
            : theme.text,
      );

      graphics.text(
        runText,

        grid.left + runStart * grid.cellWidth,

        rowBaseline(grid, row),
      );

      runText = "";
    };

    for (let col = 0; col < grid.cols; col += 1) {
      const cell = buffer[row][col];

      const kind = cell?.kind || "blank";

      const char = cell?.char ?? "_";

      if (runKind === null) {
        runKind = kind;

        runStart = col;
      } else if (kind !== runKind) {
        flush();

        runKind = kind;

        runStart = col;
      }

      runText += char;
    }

    flush();
  }

  graphics.pop();
}

/* =========================================================
   COVER
   ========================================================= */

function drawCover(graphics, state, slideIndex = 0) {
  const grid = getGrid(graphics);

  const buffer = createCoverBuffer(grid);

  writeVisual(buffer, grid, state);

  writeCoverText(buffer, grid, state, slideIndex);

  renderBuffer(graphics, grid, buffer, getThemeForState(state));
}

/* =========================================================
   BODY PAGINATION
   ========================================================= */

function paginateGridText(graphics, value) {
  const grid = getGrid(graphics);

  const lines = wrapToColumns(value, grid.cols);

  if (!lines.length) {
    return [];
  }

  const slides = [];

  for (let index = 0; index < lines.length; index += grid.rows) {
    slides.push({
      type: "text",

      lines: lines.slice(
        index,

        index + grid.rows,
      ),
    });
  }

  return slides;
}

/* =========================================================
   LOCAL MODEL NOTE
   ========================================================= */

function shortModelName(value) {
  const name = String(value || "")
    .split("/")
    .filter(Boolean)
    .pop();

  return name || "local model";
}

function formatSeconds(ms) {
  if (!Number.isFinite(ms)) {
    return null;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTrace(state) {
  const trace = state.machineAnalysis?.trace || null;

  if (!trace) {
    return [];
  }

  const lines = [];

  const runtime = [];

  if (trace.dtype) {
    runtime.push(trace.dtype);
  }

  if (trace.device) {
    runtime.push(trace.device);
  }

  const generation = formatSeconds(trace.generationMs);

  if (generation) {
    runtime.push(`generated in ${generation}`);
  }

  if (runtime.length) {
    lines.push(runtime.join(", "));
  }

  if (
    Number.isFinite(trace.inputTokens) &&
    Number.isFinite(trace.outputTokens)
  ) {
    lines.push(
      `${trace.inputTokens} tokens in, ${trace.outputTokens} tokens out`,
    );
  }

  const sampling = [];

  if (Number.isFinite(trace.temperature)) {
    sampling.push(`temperature ${trace.temperature}`);
  }

  if (Number.isFinite(trace.topP)) {
    sampling.push(`top-p ${trace.topP}`);
  }

  if (Number.isFinite(trace.repetitionPenalty)) {
    sampling.push(`repetition ${trace.repetitionPenalty}`);
  }

  if (sampling.length) {
    lines.push(sampling.join(", "));
  }

  const embedding = formatSeconds(trace.embeddingMs);

  if (embedding) {
    const embeddingParts = [`embedding ${embedding}`];

    if (trace.embeddingDtype) {
      embeddingParts.push(trace.embeddingDtype);
    }

    if (trace.embeddingDevice) {
      embeddingParts.push(trace.embeddingDevice);
    }

    lines.push(embeddingParts.join(", "));
  }

  return lines;
}

/* =========================================================
   LIVE LOCAL MODEL PROGRESS
   ========================================================= */

function formatLiveProgress(state) {
  const progress = state.aiProgress || null;

  if (!progress) {
    return ["preparing local model"];
  }

  if (progress.stage === "starting") {
    return ["preparing local model"];
  }

  if (progress.stage === "loading") {
    const lines = ["loading local model"];

    if (Number.isFinite(progress.percent)) {
      lines.push(`${Math.round(progress.percent)}%`);
    }

    return lines;
  }

  if (progress.stage === "generating") {
    const lines = ["writing locally"];

    if (
      Number.isFinite(progress.generatedTokens) &&
      Number.isFinite(progress.maxTokens) &&
      progress.maxTokens > 0
    ) {
      lines.push(
        `${progress.generatedTokens} of ${progress.maxTokens} token budget`,
      );

      if (Number.isFinite(progress.percent)) {
        lines.push(`${Math.round(progress.percent)}% of token budget`);
      }
    }

    if (Number.isFinite(progress.elapsedMs)) {
      lines.push(`${(progress.elapsedMs / 1000).toFixed(1)}s elapsed`);
    }

    return lines;
  }

  return [];
}

/* =========================================================
   BUILD LOCAL MODEL NOTE LINES

   Paragraph breaks from the model are preserved.

   A blank line is rendered between each paragraph.
   ========================================================= */

function buildSynthesisLines(state, grid) {
  const finishedNote = String(
    state.machineAnalysis?.synthesis?.reflection || "",
  ).trim();

  const streamingNote = String(state.aiProgress?.partialText || "").trim();

  const note = finishedNote || streamingNote;

  if (!state.machineAnalysis && !state.aiProgress) {
    return [];
  }

  const model = shortModelName(
    state.machineAnalysis?.synthesisModel || state.aiProgress?.model || "",
  );

  const lines = ["[note from local model]", model, ""];

  if (!note) {
    lines.push(...formatLiveProgress(state));

    return lines;
  }

  /*
    Only blank lines define paragraphs.

    A single accidental line break inside a paragraph
    gets joined back into prose.
  */

  const paragraphs = note
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph.replace(/\n+/g, " ").replace(/\s+/g, " ").trim(),
    )
    .filter(Boolean);

  for (let index = 0; index < paragraphs.length; index += 1) {
    lines.push(...wrapToColumns(paragraphs[index], grid.cols));

    if (index < paragraphs.length - 1) {
      lines.push("");
    }
  }

  /*
    While streaming, show progress after the
    currently generated prose.
  */

  if (!finishedNote && state.aiProgress?.stage === "generating") {
    lines.push("", "", ...formatLiveProgress(state));

    return lines;
  }

  /*
    Final runtime trace only appears after
    the interpretation is finished.
  */

  const traceLines = formatTrace(state);

  if (traceLines.length) {
    lines.push("", "", "[local trace]", "");

    for (const traceLine of traceLines) {
      lines.push(...wrapToColumns(traceLine, grid.cols));
    }
  }

  return lines;
}

/* =========================================================
   LOCAL MODEL NOTE PAGINATION

   No truncation.

   If the interpretation occupies 2, 3, 4 pages,
   create that many slides automatically.
   ========================================================= */

function paginateSynthesis(graphics, state) {
  const grid = getGrid(graphics);

  const allLines = buildSynthesisLines(state, grid);

  if (!allLines.length) {
    return [];
  }

  const slides = [];

  for (let index = 0; index < allLines.length; index += grid.rows) {
    slides.push({
      type: "synthesis",

      lines: allLines.slice(
        index,

        index + grid.rows,
      ),
    });
  }

  return slides;
}

/* =========================================================
   BUILD SLIDES
   ========================================================= */

export function buildSlides(state, graphics) {
  const activeGraphics = graphics || state.p5;

  state.slides = [
    {
      type: "cover",
    },

    ...paginateGridText(activeGraphics, state.text),

    ...paginateSynthesis(activeGraphics, state),
  ];

  state.slideIndex = clamp(
    state.slideIndex,

    0,

    Math.max(
      0,

      state.slides.length - 1,
    ),
  );
}

/* =========================================================
   SHARED PAGE RENDERER
   ========================================================= */

function drawLinesPage(graphics, lines, state) {
  const grid = getGrid(graphics);

  const theme = getThemeForState(state);

  const safeLines = Array.isArray(lines) ? lines : [];

  graphics.push();

  graphics.noStroke();

  graphics.fill(theme.text);

  graphics.textFont(PRINT_FONT);

  graphics.textStyle(graphics.NORMAL);

  graphics.textSize(grid.fontSize);

  graphics.textAlign(graphics.LEFT, graphics.BASELINE);

  const visible = safeLines.slice(0, grid.rows);

  for (let row = 0; row < visible.length; row += 1) {
    const line = visible[row];

    if (!line) {
      continue;
    }

    graphics.text(
      line,

      grid.left,

      rowBaseline(grid, row),
    );
  }

  graphics.pop();
}

/* =========================================================
   BODY PAGE
   ========================================================= */

function drawTextSlide(graphics, slide, state) {
  drawLinesPage(graphics, slide.lines, state);
}

/* =========================================================
   LOCAL MODEL NOTE PAGE
   ========================================================= */

function drawSynthesisSlide(graphics, slide, state, slideIndex) {
  const reveal = publishRevealForSlide(state, slideIndex);

  const lines = reveal
    ? revealLinesByCharacters(
        slide.lines,

        reveal.visibleCharacters,
      )
    : slide.lines;

  drawLinesPage(graphics, lines, state);
}

/* =========================================================
   PUBLISH ANIMATION PLAN

   The cover and local-model synthesis pages receive typing videos.

   Human writing/body pages remain static JPGs.
   ========================================================= */

export function getPublishAnimationPlan(index, state) {
  const slide = state.slides?.[index] || null;

  if (!slide) {
    return {
      animate: false,

      totalCharacters: 0,
    };
  }

  if (slide.type === "cover") {
    const number = activeNumber(state);

    const label = number
      ? `generative thoughts #${pad(number)}`
      : "generative thoughts";

    const title = String(state.title || "Untitled").trim();

    return {
      animate: true,

      type: "cover",

      totalCharacters: Math.max(1, label.length + 1 + title.length),
    };
  }

  if (slide.type === "synthesis") {
    return {
      animate: true,

      type: "synthesis",

      totalCharacters: Math.max(
        1,

        lineCharacterCount(slide.lines),
      ),
    };
  }

  return {
    animate: false,

    type: slide.type || "slide",

    totalCharacters: 0,
  };
}

/* =========================================================
   DRAW
   ========================================================= */

export function drawSlide(index, state, graphics = state.p5) {
  if (!graphics || !state.slides.length) {
    return;
  }

  const theme = getThemeForState(state);

  graphics.background(theme.background);

  drawBackgroundTexture(graphics, state);

  const slide = state.slides[index];

  if (!slide) {
    return;
  }

  if (slide.type === "cover") {
    drawCover(graphics, state, index);

    return;
  }

  if (slide.type === "text") {
    drawTextSlide(graphics, slide, state);

    return;
  }

  if (slide.type === "synthesis") {
    drawSynthesisSlide(graphics, slide, state, index);
  }
}
