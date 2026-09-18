import {
  LAYOUT,
  PRINT_FONT,
  TYPE,
} from "./config.js";

import {
  analyzeText,
  clamp,
  fract,
  lerp,
  mulberry32,
  pad,
  stringSeed,
} from "./helpers.js";

import { paginateText } from "./pagination.js";
import { buildSynthesis } from "./analysis.js";

const TAU = Math.PI * 2;

const THEMES = [
  { background: "#e8dfcf", text: "#514b43", art: "#3c3731", dim: "#8f857a" },
  { background: "#f0ede6", text: "#4a544e", art: "#34403a", dim: "#91a099" },
  { background: "#ece8f1", text: "#585067", art: "#40374f", dim: "#9a92ab" },
  { background: "#f3e9e3", text: "#5a4a43", art: "#44332d", dim: "#a48b84" },
  { background: "#e7ede8", text: "#4a544b", art: "#364038", dim: "#8f9a91" },
  { background: "#e8edf2", text: "#4a5561", art: "#34414d", dim: "#8c99a7" },
  { background: "#eee9df", text: "#534d41", art: "#3c362e", dim: "#968c7b" },
  { background: "#f0e9ec", text: "#5c4d58", art: "#463641", dim: "#a0909a" },
];

function activeNumber(state) {
  return state.currentIndex || state.nextIndex || 1;
}

function makeFeatureVector(state) {
  const f = analyzeText(`${state.title}\n${state.text}`);
  const seed = stringSeed(`${state.title}|${state.text}|${state.visualSeed}`);

  const hashUnit = (label) =>
    (stringSeed(`${label}|${state.title}|${state.text}|${state.visualSeed}`) % 100000) / 99999;

  return {
    raw: f,
    seed,
    length: clamp(Math.log1p(f.words) / Math.log(900), 0, 1),
    punctuation: clamp((f.punctuation / Math.max(1, f.words)) * 4.5, 0, 1),
    paragraphing: clamp(f.paragraphs / 14, 0, 1),
    sentenceVariance: clamp(Math.sqrt(f.sentenceVariance) / 22, 0, 1),
    lexical: clamp(f.lexicalDensity, 0, 1),
    repetition: clamp(f.repetition * 2.2, 0, 1),
    questions: clamp(f.questions / 5, 0, 1),
    averageWord: clamp((f.averageWord - 3) / 7, 0, 1),
    breaks: clamp(f.lineBreaks / 18, 0, 1),
    semanticA: hashUnit("semantic-a"),
    semanticB: hashUnit("semantic-b"),
    semanticC: hashUnit("semantic-c"),
    semanticD: hashUnit("semantic-d"),
  };
}

function rotate(x, y, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - y * s, y: x * s + y * c };
}

function smoothPulse(value, center, width) {
  const distance = Math.abs(value - center);
  return clamp(1 - distance / Math.max(0.0001, width), 0, 1);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);

  const t = c1 / c2;
  const ix = ax + vx * t;
  const iy = ay + vy * t;
  return Math.hypot(px - ix, py - iy);
}

function boundsFromPoints(points) {
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

  return { minX, minY, maxX, maxY };
}

function normalizePoints(points, scale = 0.92) {
  if (!points.length) return points;
  const box = boundsFromPoints(points);
  const w = Math.max(0.001, box.maxX - box.minX);
  const h = Math.max(0.001, box.maxY - box.minY);
  const s = (2 * scale) / Math.max(w, h);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;

  return points.map((point) => ({
    x: (point.x - cx) * s,
    y: (point.y - cy) * s,
  }));
}

function createLSystemTrace(random, complexity) {
  const presets = [
    {
      axiom: "F",
      rules: { F: "F[+F]F[-F]F" },
      iterations: 2 + Math.floor(random() * 2),
      angle: TAU * lerp(0.05, 0.11, random()),
    },
    {
      axiom: "F-F-F-F",
      rules: { F: "FF-F-F-F-FF" },
      iterations: 2 + Math.floor(random() * 2),
      angle: TAU / 8,
    },
    {
      axiom: "X",
      rules: { X: "F-[[X]+X]+F[+FX]-X", F: "FF" },
      iterations: 3,
      angle: TAU * lerp(0.035, 0.08, random()),
    },
    {
      axiom: "F++F++F",
      rules: { F: "F-F++F-F" },
      iterations: 2 + Math.floor(random() * 2),
      angle: TAU / 6,
    },
  ];

  const preset = presets[Math.floor(random() * presets.length)];
  let sequence = preset.axiom;

  for (let i = 0; i < preset.iterations; i += 1) {
    let next = "";
    for (const ch of sequence) {
      next += preset.rules[ch] || ch;
      if (next.length > 12000) break;
    }
    sequence = next.slice(0, 12000);
  }

  let x = 0;
  let y = 0;
  let heading = random() * TAU;
  const step = lerp(0.045, 0.09, 1 - complexity * 0.35);
  const stack = [];
  const points = [{ x, y }];

  for (const ch of sequence) {
    if (ch === "F" || ch === "G") {
      x += Math.cos(heading) * step;
      y += Math.sin(heading) * step;
      points.push({ x, y });
    } else if (ch === "+") {
      heading += preset.angle;
    } else if (ch === "-") {
      heading -= preset.angle;
    } else if (ch === "[") {
      stack.push({ x, y, heading });
    } else if (ch === "]" && stack.length) {
      const state = stack.pop();
      x = state.x;
      y = state.y;
      heading = state.heading;
      points.push({ x, y });
    }
  }

  const normalized = normalizePoints(points);
  const segments = [];
  for (let i = 1; i < normalized.length; i += 1) {
    const a = normalized[i - 1];
    const b = normalized[i];
    segments.push([a.x, a.y, b.x, b.y]);
  }

  return {
    type: "trace",
    mode: "lsystem",
    segments,
    thickness: lerp(0.02, 0.075, random()),
    echo: random() < 0.7 ? 1 + Math.floor(random() * 4) : 0,
    echoGap: 0.03 + random() * 0.07,
    weight: 0.24 + random() * 0.5,
    rotation: (random() - 0.5) * TAU,
    scale: 0.7 + random() * 0.9,
    offsetX: (random() - 0.5) * 0.45,
    offsetY: (random() - 0.5) * 0.45,
  };
}

function createOrbitTrace(random, complexity) {
  const loops = 1 + Math.floor(random() * (2 + complexity * 3));
  const points = [];
  const a = 0.3 + random() * 0.8;
  const b = 0.2 + random() * 0.7;
  const lobeA = 1 + Math.floor(random() * 6);
  const lobeB = 1 + Math.floor(random() * 6);
  const phase = random() * TAU;
  const total = 130 + Math.floor(random() * 220);

  for (let i = 0; i <= total; i += 1) {
    const t = (i / total) * TAU * loops;
    points.push({
      x: Math.cos(t * lobeA + phase) * a + Math.cos(t * 0.41) * 0.08,
      y: Math.sin(t * lobeB) * b + Math.sin(t * 0.53 - phase) * 0.08,
    });
  }

  const normalized = normalizePoints(points);
  const segments = [];
  for (let i = 1; i < normalized.length; i += 1) {
    const p0 = normalized[i - 1];
    const p1 = normalized[i];
    segments.push([p0.x, p0.y, p1.x, p1.y]);
  }

  return {
    type: "trace",
    mode: "orbit",
    segments,
    thickness: lerp(0.018, 0.06, random()),
    echo: random() < 0.85 ? 1 + Math.floor(random() * 3) : 0,
    echoGap: 0.025 + random() * 0.05,
    weight: 0.2 + random() * 0.42,
    rotation: (random() - 0.5) * TAU,
    scale: 0.65 + random() * 0.8,
    offsetX: (random() - 0.5) * 0.32,
    offsetY: (random() - 0.5) * 0.32,
  };
}

function createFieldPolyline(random, complexity) {
  const points = [];
  let x = (random() - 0.5) * 0.8;
  let y = (random() - 0.5) * 0.8;
  let angle = random() * TAU;
  const count = 50 + Math.floor(random() * (80 + complexity * 120));
  const step = 0.02 + random() * 0.035;
  const freq = 1.8 + random() * 4.4;
  const amp = 0.35 + random() * 1.1;
  const phase = random() * TAU;

  points.push({ x, y });

  for (let i = 0; i < count; i += 1) {
    const t = i / count;
    angle += Math.sin(t * freq * TAU + phase) * 0.18 * amp + (random() - 0.5) * 0.06;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    points.push({ x, y });
  }

  const normalized = normalizePoints(points);
  const segments = [];
  for (let i = 1; i < normalized.length; i += 1) {
    const a = normalized[i - 1];
    const b = normalized[i];
    segments.push([a.x, a.y, b.x, b.y]);
  }

  return {
    type: "trace",
    mode: "flow",
    segments,
    thickness: lerp(0.02, 0.06, random()),
    echo: random() < 0.6 ? 1 + Math.floor(random() * 2) : 0,
    echoGap: 0.03 + random() * 0.05,
    weight: 0.22 + random() * 0.38,
    rotation: (random() - 0.5) * TAU,
    scale: 0.7 + random() * 0.8,
    offsetX: (random() - 0.5) * 0.38,
    offsetY: (random() - 0.5) * 0.38,
  };
}

function layerValue(type, x, y, p) {
  const point = rotate((x - p.cx) / p.sx, (y - p.cy) / p.sy, p.rotation);

  let px = point.x;
  let py = point.y;

  if (p.bend) {
    px += Math.sin(py * p.bendFrequency + p.phase) * p.bend;
    py += Math.cos(px * p.bendFrequency * 0.73 - p.phase) * p.bend * 0.55;
  }

  if (p.swirl) {
    const r = Math.hypot(px, py);
    const a = Math.atan2(py, px) + p.swirl * Math.exp(-r * 0.85);
    px = Math.cos(a) * r;
    py = Math.sin(a) * r;
  }

  const r = Math.hypot(px, py);
  const a = Math.atan2(py, px);

  if (type === "ring") {
    const radius = p.radius + Math.sin(a * p.lobes + p.phase) * p.modulation;
    return smoothPulse(r, radius, p.thickness);
  }

  if (type === "wave") {
    const target =
      Math.sin(px * p.frequency + p.phase) * p.amplitude +
      Math.sin(px * p.frequency * 0.43 - p.phase * 0.7) * p.modulation;
    return smoothPulse(py, target, p.thickness);
  }

  if (type === "doubleWave") {
    const a1 = Math.sin(px * p.frequency + p.phase) * p.amplitude;
    const a2 = Math.cos(px * (p.frequency * 0.68) - p.phase) * p.amplitude * 0.72;
    return Math.max(smoothPulse(py, a1, p.thickness), smoothPulse(py, a2, p.thickness));
  }

  if (type === "spiral") {
    const wrapped = fract(a / TAU + 1);
    const target = p.radius * 0.25 + wrapped * p.radius * p.turns;
    const alternate = Math.abs(r - target);
    const repeated = Math.min(
      alternate,
      Math.abs(r - (target - p.radius)),
      Math.abs(r - (target + p.radius))
    );
    return clamp(1 - repeated / p.thickness, 0, 1);
  }

  if (type === "saddle") {
    const value = px * px * p.a - py * py * p.b + p.offset;
    return smoothPulse(value, 0, p.thickness);
  }

  if (type === "superellipse") {
    const n = p.power;
    const value = Math.pow(Math.abs(px), n) + Math.pow(Math.abs(py), n);
    return smoothPulse(value, p.radius, p.thickness);
  }

  if (type === "lattice") {
    const gx = Math.abs(Math.sin(px * p.frequency + p.phase));
    const gy = Math.abs(Math.sin(py * p.frequency * p.ratio - p.phase));
    return clamp(1 - Math.min(gx, gy) / p.thickness, 0, 1);
  }

  if (type === "interference") {
    const d1 = Math.hypot(px - p.fx1, py - p.fy1);
    const d2 = Math.hypot(px - p.fx2, py - p.fy2);
    const signal =
      Math.sin(d1 * p.frequency + p.phase) +
      Math.sin(d2 * p.frequency * p.ratio - p.phase);
    return smoothPulse(signal, p.offset, p.thickness * 2.1);
  }

  if (type === "rays") {
    const signal = Math.cos(a * p.lobes + p.phase);
    return smoothPulse(signal, p.offset, p.thickness * 2) * Math.exp(-r * p.decay);
  }

  if (type === "contour") {
    const surface =
      Math.sin(px * p.frequency + p.phase) * 0.55 +
      Math.cos(py * p.frequency * p.ratio - p.phase) * 0.45 +
      Math.sin((px + py) * p.frequency * 0.37) * p.modulation;
    const band = Math.abs(fract(surface * p.bands) - 0.5) * 2;
    return clamp(1 - band / p.thickness, 0, 1);
  }

  if (type === "metaball") {
    let total = 0;
    for (const center of p.centers) {
      const dx = px - center.x;
      const dy = py - center.y;
      total += center.weight / (0.08 + dx * dx + dy * dy);
    }
    const normalized = Math.tanh(total * 0.12);
    return smoothPulse(normalized, p.offset, p.thickness);
  }

  if (type === "orbit") {
    const ellipse = Math.sqrt(
      Math.pow(px / Math.max(0.1, p.a), 2) + Math.pow(py / Math.max(0.1, p.b), 2)
    );
    const wobble = Math.sin(a * p.lobes + p.phase) * p.modulation;
    return smoothPulse(ellipse + wobble, p.radius, p.thickness);
  }

  if (type === "fold") {
    const signal =
      Math.sin((px + Math.sin(py * p.frequency) * p.modulation) * p.frequency + p.phase) *
      Math.cos((py + Math.cos(px * p.frequency * 0.7) * p.modulation) * p.frequency * p.ratio);
    return smoothPulse(signal, p.offset, p.thickness * 2);
  }

  return 0;
}

function createLayer(random, complexity, features) {
  const types = [
    "ring",
    "wave",
    "doubleWave",
    "spiral",
    "saddle",
    "superellipse",
    "lattice",
    "interference",
    "rays",
    "contour",
    "metaball",
    "orbit",
    "fold",
  ];

  const centers = Array.from(
    { length: 2 + Math.floor(random() * (2 + complexity * 5)) },
    () => ({
      x: (random() - 0.5) * 1.6,
      y: (random() - 0.5) * 1.6,
      weight: 0.35 + random() * 1.35,
    })
  );

  return {
    type: types[Math.floor(random() * types.length)],
    weight: 0.3 + random() * 1.18,
    operator: random(),
    cx: (random() - 0.5) * lerp(0.16, 0.96, features.sentenceVariance),
    cy: (random() - 0.5) * lerp(0.12, 0.88, features.paragraphing),
    sx: 0.38 + random() * 1.5,
    sy: 0.38 + random() * 1.5,
    rotation: random() * TAU,
    radius: 0.18 + random() * 1.15,
    thickness: 0.03 + random() * lerp(0.05, 0.22, 1 - complexity),
    frequency: 2 + random() * (5 + complexity * 16),
    amplitude: 0.1 + random() * 0.72,
    phase: random() * TAU,
    modulation: random() * lerp(0.08, 0.75, complexity),
    lobes: 2 + Math.floor(random() * (5 + complexity * 16)),
    turns: 0.6 + random() * 3.8,
    ratio: 0.3 + random() * 2,
    power: 1.3 + random() * 6.2,
    bands: 1.2 + random() * (4 + complexity * 12),
    a: 0.3 + random() * 1.6,
    b: 0.3 + random() * 1.6,
    offset: (random() - 0.5) * 0.7,
    decay: 0.2 + random() * 1.6,
    bend: random() < 0.52 + complexity * 0.35 ? (random() - 0.5) * 0.6 * (0.35 + complexity) : 0,
    bendFrequency: 1.1 + random() * 6.5,
    swirl: random() < 0.42 + complexity * 0.4 ? (random() - 0.5) * 3.1 : 0,
    fx1: (random() - 0.5) * 0.95,
    fy1: (random() - 0.5) * 0.95,
    fx2: (random() - 0.5) * 0.95,
    fy2: (random() - 0.5) * 0.95,
    centers,
  };
}

function createTextureSystem(random, features) {
  const styles = ["speckle", "scan", "cross", "grid", "drift", "dust"];
  const count = 1 + Math.floor(random() * 2);
  const chosen = [];

  while (chosen.length < count) {
    const style = styles[Math.floor(random() * styles.length)];
    if (!chosen.includes(style)) chosen.push(style);
  }

  return {
    styles: chosen,
    density: 60 + Math.floor(random() * 120),
    spacing: 14 + random() * 24,
    alpha: 22 + random() * 22,
    tilt: (random() - 0.5) * 0.8,
    breaks: features.breaks,
  };
}

function createVisualSystem(state) {
  const features = makeFeatureVector(state);
  const random = mulberry32(features.seed ^ state.visualSeed);

  const complexity = clamp(
    Math.pow(random(), 0.72) * 0.48 +
      features.length * 0.18 +
      features.punctuation * 0.08 +
      features.sentenceVariance * 0.08 +
      features.lexical * 0.05 +
      features.breaks * 0.06 +
      features.paragraphing * 0.07,
    0,
    1
  );

  const fieldLayerCount =
    complexity < 0.18
      ? 2 + Math.floor(random() * 2)
      : 4 + Math.floor(random() * (4 + Math.round(complexity * 8)));

  const layers = Array.from({ length: fieldLayerCount }, () => createLayer(random, complexity, features));

  const traceCount =
    2 + Math.floor(random() * (2 + Math.round(complexity * 4) + Math.round(features.breaks * 2)));

  const traces = [];
  for (let i = 0; i < traceCount; i += 1) {
    const pick = random();
    if (pick < 0.34) traces.push(createLSystemTrace(random, complexity));
    else if (pick < 0.68) traces.push(createOrbitTrace(random, complexity));
    else traces.push(createFieldPolyline(random, complexity));
  }

  const glyphFamilies = [
    {
      air: [".", ".", ":", "'"],
      horizontal: ["_", "-", "=", "="],
      vertical: ["|", "|", ":"],
      rising: ["/", "/", "+"],
      falling: ["\\", "\\", "+"],
      curveLeft: ["(", "((", ":"],
      curveRight: [")", "))", ":"],
      hot: ["*", "*", "+", "#", "=="],
    },
    {
      air: [".", ":", ":"],
      horizontal: ["-", "=", "==", "__"],
      vertical: ["|", "||", ":"],
      rising: ["/", "+", "/"],
      falling: ["\\", "+", "\\"],
      curveLeft: ["(", "{", "("],
      curveRight: [")", "}", ")"],
      hot: ["*", "**", "+", "#", "++"],
    },
    {
      air: [".", ".", ":"],
      horizontal: ["_", "__", "-", "="],
      vertical: ["|", "||"],
      rising: ["/", "/"],
      falling: ["\\", "\\", "\\\\"],
      curveLeft: ["(", "(("],
      curveRight: [")", "))"],
      hot: ["*", "**", "+", "++", "#"],
    },
  ];

  return {
    features,
    randomSeed: features.seed,
    complexity,
    layers,
    traces,
    texture: createTextureSystem(random, features),
    themeIndex: Math.floor(random() * THEMES.length),
    globalRotation: (random() - 0.5) * TAU,
    xStretch: 0.72 + random() * 0.72,
    yStretch: 0.72 + random() * 0.72,
    globalBend: (random() - 0.5) * complexity * 0.42,
    globalBendFrequency: 1.2 + random() * 6.4,
    threshold: lerp(0.76, 0.18, complexity) + (random() - 0.5) * 0.08,
    densityChance: lerp(0.35, 1.02, complexity) * lerp(0.88, 1.12, features.lexical),
    voidStrength: random() < 0.64 ? random() * complexity * 0.9 : 0,
    voidX: (random() - 0.5) * 0.85,
    voidY: (random() - 0.5) * 0.85,
    voidRadius: 0.07 + random() * 0.48,
    symmetry: random() < 0.28 ? 2 + Math.floor(random() * 8) : 1,
    contourize: random() < 0.56 + complexity * 0.28,
    contourBands: 2 + Math.floor(random() * (4 + complexity * 11)),
    cropMode: random(),
    satelliteChance: random() * random() * lerp(0.02, 0.16, complexity),
    jitter: random() * lerp(0.35, 3.8, complexity),
    charScale: 0.9 + random() * 0.4,
    glyphs: glyphFamilies[Math.floor(random() * glyphFamilies.length)],
  };
}

function getVisualSystem(state) {
  const key = `${state.title}|${state.text}|${state.visualSeed}`;
  if (state.__visualKey !== key || !state.__visualSystem) {
    state.__visualSystem = createVisualSystem(state);
    state.__visualKey = key;
  }
  return state.__visualSystem;
}

export function getThemeForState(state) {
  const system = getVisualSystem(state);
  return THEMES[system.themeIndex % THEMES.length];
}

export function applyThemeToDocument(state) {
  const theme = getThemeForState(state);
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--dim", theme.dim);
  root.style.setProperty("--outline", `${theme.text}22`);
}

function traceValue(trace, x, y) {
  let point = rotate(x, y, trace.rotation);
  const px = point.x / trace.scale - trace.offsetX;
  const py = point.y / trace.scale - trace.offsetY;
  let best = Infinity;

  for (const [ax, ay, bx, by] of trace.segments) {
    best = Math.min(best, distToSegment(px, py, ax, ay, bx, by));
  }

  let value = clamp(1 - best / trace.thickness, 0, 1);

  if (trace.echo) {
    for (let i = 1; i <= trace.echo; i += 1) {
      const d = Math.abs(best - trace.echoGap * i);
      value = Math.max(value, clamp(1 - d / (trace.thickness * 0.75), 0, 1) * (0.72 - i * 0.1));
    }
  }

  return value * trace.weight;
}

function evaluateField(system, x, y, phase = 0) {
  let point = rotate(x * system.xStretch, y * system.yStretch, system.globalRotation);

  let px = point.x + Math.sin(point.y * system.globalBendFrequency + phase * 0.08) * system.globalBend;
  let py = point.y + Math.cos(point.x * system.globalBendFrequency * 0.81 - phase * 0.06) * system.globalBend * 0.6;

  if (system.symmetry > 1) {
    const radius = Math.hypot(px, py);
    let angle = Math.atan2(py, px);
    const sector = TAU / system.symmetry;
    angle = Math.abs(((angle + sector * 0.5) % sector) - sector * 0.5);
    px = Math.cos(angle) * radius;
    py = Math.sin(angle) * radius;
  }

  let value = 0;

  system.layers.forEach((layer, index) => {
    const next = layerValue(layer.type, px, py, {
      ...layer,
      phase: layer.phase + phase * (0.05 + index * 0.013),
    });

    if (index === 0) {
      value = next * layer.weight;
      return;
    }

    const op = layer.operator;
    if (op < 0.24) value += next * layer.weight;
    else if (op < 0.46) value = Math.max(value, next * layer.weight);
    else if (op < 0.62) value = Math.abs(value - next * layer.weight);
    else if (op < 0.79) value *= lerp(0.4, 1.4, next);
    else value = Math.min(1.8, value + next * next * layer.weight);
  });

  for (const trace of system.traces) {
    const t = traceValue(trace, px, py);
    value = Math.max(value, t * 0.95) + t * 0.18;
  }

  value = Math.tanh(value * lerp(1.2, 2.8, system.complexity));

  if (system.contourize) {
    const band = Math.abs(fract(value * system.contourBands) - 0.5) * 2;
    const contour = 1 - band;
    value = lerp(value, contour, 0.26 + system.complexity * 0.4);
  }

  if (system.voidStrength) {
    const d = Math.hypot(px - system.voidX, py - system.voidY);
    value -= clamp(1 - d / system.voidRadius, 0, 1) * system.voidStrength;
  }

  return value;
}

function glyphFor(system, value, gx, gy, x, random) {
  const angle = Math.atan2(gy, gx);
  const tangent = angle + Math.PI / 2;
  const ax = Math.cos(tangent);
  const ay = Math.sin(tangent);

  let pool;
  if (value > 0.9) pool = system.glyphs.hot;
  else if (Math.abs(ax) > 0.82) pool = system.glyphs.horizontal;
  else if (Math.abs(ay) > 0.82) pool = system.glyphs.vertical;
  else if (ax * ay < 0) pool = system.glyphs.rising;
  else pool = system.glyphs.falling;

  if (value > 0.44 && value < 0.8 && random() < 0.28) {
    pool = x < 0 ? system.glyphs.curveLeft : system.glyphs.curveRight;
  }

  if (value < 0.48 && random() < 0.46) {
    pool = system.glyphs.air;
  }

  return pool[Math.floor(random() * pool.length)];
}

function drawBackgroundTexture(graphics, state, phase) {
  const system = getVisualSystem(state);
  const theme = getThemeForState(state);
  const random = mulberry32(system.randomSeed ^ 0x4f1bbcdc);

  const dim = graphics.color(theme.dim);
  dim.setAlpha(system.texture.alpha);

  const faint = graphics.color(theme.text);
  faint.setAlpha(Math.max(10, system.texture.alpha - 10));

  graphics.push();
  graphics.noFill();
  graphics.strokeWeight(1);

  for (const style of system.texture.styles) {
    if (style === "speckle" || style === "dust") {
      graphics.noStroke();
      graphics.fill(dim);
      for (let i = 0; i < system.texture.density; i += 1) {
        const x = random() * graphics.width;
        const y = random() * graphics.height;
        const size = style === "dust" ? 1 + random() * 1.8 : 1;
        graphics.circle(x, y, size);
      }
      graphics.noFill();
    }

    if (style === "scan") {
      graphics.stroke(faint);
      const step = system.texture.spacing * 0.8;
      for (let y = -20; y < graphics.height + 20; y += step) {
        graphics.line(0, y + Math.sin(y * 0.01 + phase * 0.1) * 2, graphics.width, y + Math.sin(y * 0.01 + phase * 0.1) * 2);
      }
    }

    if (style === "cross") {
      graphics.stroke(dim);
      const step = system.texture.spacing;
      for (let x = -graphics.height; x < graphics.width + graphics.height; x += step * 1.8) {
        graphics.line(x, 0, x + graphics.height * 0.2, graphics.height);
      }
      for (let x = -graphics.height; x < graphics.width + graphics.height; x += step * 2.2) {
        graphics.line(x, graphics.height, x + graphics.height * 0.2, 0);
      }
    }

    if (style === "grid") {
      graphics.stroke(dim);
      const step = system.texture.spacing * 1.15;
      for (let x = 0; x < graphics.width; x += step) {
        graphics.line(x, 0, x, graphics.height);
      }
      for (let y = 0; y < graphics.height; y += step) {
        graphics.line(0, y, graphics.width, y);
      }
    }

    if (style === "drift") {
      graphics.stroke(faint);
      for (let i = 0; i < 22; i += 1) {
        const y = random() * graphics.height;
        const x0 = random() * graphics.width;
        const len = 18 + random() * 52;
        graphics.line(x0, y, x0 + len, y + Math.sin(i + phase * 0.12) * 3);
      }
    }
  }

  graphics.pop();
}

function drawAsciiGeometry(graphics, state, phase = 0) {
  const system = getVisualSystem(state);
  const theme = getThemeForState(state);
  const random = mulberry32(system.randomSeed ^ 0x85ebca6b);

  const left = LAYOUT.left;
  const right = LAYOUT.right;
  const top = LAYOUT.coverArtTop;
  const bottom = LAYOUT.coverArtBottom;

  const cols = Math.round(lerp(48, 78, system.complexity));
  const rows = Math.round(lerp(38, 58, system.complexity));

  const cellW = (right - left) / cols;
  const cellH = (bottom - top) / rows;
  const epsilon = 0.008;

  graphics.push();
  graphics.noStroke();
  graphics.textFont(PRINT_FONT);
  graphics.textStyle(graphics.NORMAL);
  graphics.textAlign(graphics.CENTER, graphics.CENTER);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const px = left + (col + 0.5) * cellW;
      const py = top + (row + 0.5) * cellH;

      const x = (col / Math.max(1, cols - 1) - 0.5) * 2;
      const y = (row / Math.max(1, rows - 1) - 0.5) * 2;

      let value = evaluateField(system, x, y, phase);

      if (system.cropMode < 0.12 && Math.abs(x) + Math.abs(y) > 1.26) {
        value *= 0.28;
      }

      const satellite = random() < system.satelliteChance;
      if (value < system.threshold && !satellite) continue;

      const probability = clamp((value - system.threshold) * 1.85 + 0.25, 0, 1) * system.densityChance;
      if (!satellite && random() > probability) continue;

      const gx = evaluateField(system, x + epsilon, y, phase) - evaluateField(system, x - epsilon, y, phase);
      const gy = evaluateField(system, x, y + epsilon, phase) - evaluateField(system, x, y - epsilon, phase);

      const glyph = satellite
        ? system.glyphs.air[Math.floor(random() * system.glyphs.air.length)]
        : glyphFor(system, value, gx, gy, x, random);

      const art = graphics.color(value > 0.76 ? theme.art : theme.dim);
      art.setAlpha(value > 0.76 ? 255 : 225);
      graphics.fill(art);

      graphics.textSize(Math.max(10.5, Math.min(cellW, cellH) * 0.86 * system.charScale));
      graphics.text(
        glyph,
        px + (random() - 0.5) * system.jitter,
        py + (random() - 0.5) * system.jitter
      );
    }
  }

  graphics.pop();
}

export function buildSlides(state, graphics) {
  const textSlides = paginateText(graphics, state.text);
  state.slides = [{ type: "cover" }, ...textSlides, { type: "synthesis" }];
  state.slideIndex = clamp(state.slideIndex, 0, Math.max(0, state.slides.length - 1));
}

function drawCover(graphics, state, phase) {
  const theme = getThemeForState(state);
  drawAsciiGeometry(graphics, state, phase);

  graphics.push();
  graphics.noStroke();
  graphics.textFont(PRINT_FONT);
  graphics.textStyle(graphics.NORMAL);
  graphics.fill(theme.text);
  graphics.textSize(TYPE.size);
  graphics.textLeading(TYPE.size * TYPE.leading);
  graphics.textAlign(graphics.LEFT, graphics.TOP);

  graphics.text(`generative thoughts #${pad(activeNumber(state))}`, LAYOUT.left, LAYOUT.top);
  graphics.text(
    state.title || "Untitled",
    LAYOUT.left,
    LAYOUT.coverTitleY,
    LAYOUT.width,
    LAYOUT.bottom - LAYOUT.coverTitleY
  );

  graphics.pop();
}

function drawTextSlide(graphics, slide, state) {
  const theme = getThemeForState(state);

  graphics.push();
  graphics.noStroke();
  graphics.fill(theme.text);
  graphics.textFont(PRINT_FONT);
  graphics.textStyle(graphics.NORMAL);
  graphics.textSize(TYPE.size);
  graphics.textAlign(graphics.LEFT, graphics.BASELINE);

  let y = LAYOUT.top + TYPE.size;

  for (const line of slide.lines) {
    if (line !== "") {
      graphics.text(line, LAYOUT.left, y);
    }
    y += slide.lineHeight;
  }

  graphics.pop();
}

function drawSynthesisSlide(graphics, state) {
  const theme = getThemeForState(state);
  const data = buildSynthesis(state);
  const machine = data.machine?.synthesis || null;
  const nearest = data.machine?.nearest || [];
  const lines = [];

  lines.push(data.timestamp);
  lines.push("");
  lines.push(`typing          ${data.typingTime}`);
  lines.push(`words           ${data.features.words}`);
  lines.push(`characters      ${data.features.characters}`);
  lines.push(`sentences       ${data.features.sentences}`);
  lines.push(`paragraphs      ${data.features.paragraphs}`);

  lines.push("");
  lines.push("what returns");

  if (machine?.recurring_concepts?.length) {
    for (const item of machine.recurring_concepts.slice(0, 5)) lines.push(String(item));
  } else if (data.lexicalTerms.length) {
    for (const item of data.lexicalTerms.slice(0, 5)) {
      lines.push(item.count > 1 ? `${item.word}  ${item.count}` : item.word);
    }
  }

  if (machine?.tensions?.length) {
    lines.push("");
    lines.push("pressure points");
    for (const item of machine.tensions.slice(0, 3)) lines.push(String(item));
  }

  if (machine?.movement) {
    lines.push("");
    lines.push("movement");
    lines.push(String(machine.movement));
  }

  if (machine?.undercurrent) {
    lines.push("");
    lines.push("undercurrent");
    lines.push(String(machine.undercurrent));
  }

  if (nearest.length) {
    lines.push("");
    lines.push("near");
    for (const item of nearest.slice(0, 3)) {
      lines.push(`#${pad(item.index)}  ${Math.round(item.similarity * 100)}%`);
    }
  }

  graphics.push();
  graphics.noStroke();
  graphics.textFont(PRINT_FONT);
  graphics.textStyle(graphics.NORMAL);
  graphics.textSize(TYPE.size);
  graphics.textLeading(TYPE.size * TYPE.leading);
  graphics.textAlign(graphics.LEFT, graphics.TOP);
  graphics.fill(theme.text);

  const maxLines = Math.floor(LAYOUT.height / (TYPE.size * TYPE.leading));
  let y = LAYOUT.top;
  for (const line of lines.slice(0, maxLines)) {
    graphics.text(line, LAYOUT.left, y, LAYOUT.width, TYPE.size * TYPE.leading);
    y += TYPE.size * TYPE.leading;
  }

  graphics.pop();
}

export function drawSlide(index, state, graphics = state.p5, phase = 0) {
  if (!graphics || !state.slides.length) return;

  const theme = getThemeForState(state);
  graphics.background(theme.background);
  drawBackgroundTexture(graphics, state, phase);

  const slide = state.slides[index];
  if (slide.type === "cover") drawCover(graphics, state, phase);
  else if (slide.type === "text") drawTextSlide(graphics, slide, state);
  else drawSynthesisSlide(graphics, state);
}
