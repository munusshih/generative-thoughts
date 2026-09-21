export function thoughtFilename(index) {
  return `${String(index).padStart(3, "0")}.md`;
}

export function serializeThought(record) {
  return [
    "---",
    `id: ${JSON.stringify(record.id)}`,
    `index: ${record.index}`,
    `title: ${JSON.stringify(record.title)}`,
    `created: ${JSON.stringify(record.createdAt)}`,
    `updated: ${JSON.stringify(record.updatedAt)}`,
    `typing_ms: ${Number(record.typingMs) || 0}`,
    `visual_seed: ${Number(record.visualSeed) || 1}`,
    "---",
    "",
    record.text || "",
    "",
  ].join("\n");
}

export function parseThought(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    return { meta: {}, text: markdown };
  }

  const meta = {};

  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at < 0) continue;

    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();

    try {
      meta[key] = JSON.parse(raw);
    } catch {
      meta[key] = raw;
    }
  }

  return {
    meta,
    text: markdown
      .slice(match[0].length)
      .replace(/^\n/, "")
      .replace(/\n$/, ""),
  };
}
