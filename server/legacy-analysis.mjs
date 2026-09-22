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
  const reflection = normalizeText(
    traceHeading ? noteDocument.slice(0, traceHeading.index) : noteDocument,
  );

  if (!reflection) return null;

  return {
    reflection,
    sourceHeading: noteHeading[1],
  };
}
