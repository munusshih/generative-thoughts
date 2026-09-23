function normalizeText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function withoutFrontmatter(markdown) {
  return String(markdown || "").replace(
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
    "",
  );
}

export function recoverPublishedAnalysis(markdown, { title, text }) {
  const document = withoutFrontmatter(markdown).replace(/^\s+/, "");
  const noteHeading = /^## (Afterthought|Local model note)\s*$/m.exec(document);

  if (!noteHeading) return null;

  const sourceDocument = document.slice(0, noteHeading.index);
  const titleHeading = /^# ([^\n]*)\n+/.exec(sourceDocument);

  if (!titleHeading || normalizeText(titleHeading[1]) !== normalizeText(title)) {
    return null;
  }

  const sourceText = sourceDocument
    .slice(titleHeading[0].length)
    .replace(/\n+---\s*$/, "");

  if (normalizeText(sourceText) !== normalizeText(text)) {
    return null;
  }

  const noteDocument = document.slice(noteHeading.index + noteHeading[0].length);
  const traceHeading = /^## Local model trace\s*$/m.exec(noteDocument);
  const imageHeading = /^## Image synthesis source\s*$/m.exec(noteDocument);
  const reflectionEnd = [traceHeading?.index, imageHeading?.index]
    .filter(Number.isInteger)
    .sort((a, b) => a - b)[0];
  const reflection = normalizeText(
    Number.isInteger(reflectionEnd)
      ? noteDocument.slice(0, reflectionEnd)
      : noteDocument,
  );

  if (!reflection) return null;

  let imageInterlude = null;

  if (traceHeading) {
    const traceDocument = noteDocument.slice(
      traceHeading.index + traceHeading[0].length,
    );
    const traceBlock = /```json\s*\n([\s\S]*?)\n```/.exec(traceDocument);

    if (traceBlock) {
      try {
        imageInterlude = JSON.parse(traceBlock[1])?.imageInterlude || null;
      } catch {
        /* A malformed trace must not hide an otherwise valid reflection. */
      }
    }
  }

  return {
    reflection,
    sourceHeading: noteHeading[1],
    ...(imageInterlude ? { imageInterlude } : {}),
  };
}
