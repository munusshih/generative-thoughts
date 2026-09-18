import { TYPING_PAUSE_MS } from "./config.js";

export function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function fract(value) {
  return value - Math.floor(value);
}

export function pad(number, size = 3) {
  return String(number).padStart(size, "0");
}

export function stringSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeTyping(typing = {}) {
  return {
    startedAt: typing.startedAt ?? null,
    lastInputAt: typing.lastInputAt ?? null,
    activeMs: Number.isFinite(typing.activeMs) ? typing.activeMs : 0,
  };
}

export function trackTyping(typing, now = Date.now()) {
  const next = normalizeTyping(typing);

  if (!next.startedAt) next.startedAt = now;

  if (next.lastInputAt) {
    const gap = now - next.lastInputAt;
    if (gap > 0 && gap <= TYPING_PAUSE_MS) next.activeMs += gap;
  }

  next.lastInputAt = now;
  return next;
}

export function formatDuration(milliseconds = 0) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function analyzeText(text) {
  const source = String(text || "");
  const tokens = source.match(/\S+/g) || [];
  const clean = source.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  const unique = new Set(clean);
  const punctuation = (source.match(/[.,!?;:—–-]/g) || []).length;

  const sentences = source.trim()
    ? (source.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [])
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const lengths = sentences.map((s) => (s.match(/\S+/g) || []).length);
  const mean = lengths.length
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length
    : 0;
  const variance = lengths.length
    ? lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lengths.length
    : 0;

  return {
    characters: source.length,
    words: tokens.length,
    uniqueWords: unique.size,
    punctuation,
    paragraphs: source.trim()
      ? source.split(/\n\s*\n/).filter((x) => x.trim()).length
      : 0,
    sentences: sentences.length,
    meanSentence: mean,
    sentenceVariance: variance,
    lexicalDensity: clean.length ? unique.size / clean.length : 0,
    repetition: clean.length ? 1 - unique.size / clean.length : 0,
    lineBreaks: (source.match(/\n/g) || []).length,
    questions: (source.match(/\?/g) || []).length,
    averageWord: clean.length
      ? clean.reduce((sum, word) => sum + word.length, 0) / clean.length
      : 0,
  };
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","than","of","to","in","on","for",
  "with","from","by","at","as","is","are","was","were","be","been","being",
  "this","that","these","those","it","its","i","me","my","mine","we","us","our",
  "ours","you","your","yours","they","them","their","theirs","he","him","his",
  "she","her","hers","not","no","so","do","does","did","have","has","had","can",
  "could","would","should","will","just","about","into","over","under","more",
  "most","some","any","what","when","where","why","how","who","which"
]);

export function extractRecurringTerms(text, limit = 5) {
  const words = String(text || "").toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  const counts = new Map();

  for (const word of words) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}
