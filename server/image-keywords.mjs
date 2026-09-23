const STOP_WORDS = new Set(
  `
  about after again against almost also among another any are because been before
  being between both but can could did does doing each even every few for from had
  has have having here how into its itself just many may might more most much must
  never not now only other our out over own same should since some still such than
  that the their them then there these they this those through too under until very
  was were what when where which while who why will with would you your
  article author model local synthesis writing written page pages thing things
  really want like make made use using used
  `.trim().split(/\s+/),
);

function tokenize(value) {
  return (String(value || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) || [])
    .map((word) => word.replace(/[’']/g, "'").replace(/^'+|'+$/g, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function addScores(scores, words, weight) {
  for (const word of words) {
    const lengthBonus = Math.min(1.5, Math.max(0, word.length - 4) * 0.12);
    scores.set(word, (scores.get(word) || 0) + weight + lengthBonus);
  }
}

export function deriveImageSearch({ title, text, reflection }) {
  const titleWords = tokenize(title);
  const sourceWords = tokenize(text);
  const reflectionWords = tokenize(reflection);
  const scores = new Map();

  addScores(scores, titleWords, 7);
  addScores(scores, sourceWords, 2.2);
  addScores(scores, reflectionWords, 0.45);

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
  const keywords = ranked.slice(0, 5);
  const titleQuery = [...new Set(titleWords)].slice(0, 3).join(" ");
  const queries = [
    titleQuery,
    ...keywords.slice(0, 4),
    keywords.slice(0, 2).join(" "),
  ].filter((query, index, values) => query && values.indexOf(query) === index);

  return {
    keywords: keywords.length ? keywords : ["memory"],
    queries: queries.length ? queries : ["memory"],
  };
}
