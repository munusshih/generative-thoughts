import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseThought,
  serializeThought,
  thoughtFilename,
} from "../server/archive-format.mjs";
import {
  readJSON,
  writeJSONAtomic,
  writeTextAtomic,
} from "../server/atomic-files.mjs";
import {
  pageName,
  publicationDirectoryName,
  publicationPrefix,
  slugify,
} from "../server/publication-naming.mjs";
import { getAnalysisPolicy } from "../dist/studio/analysis-policy.js";
import {
  AI_MODELS,
  requireLocalModelId,
} from "../dist/model-config.js";
import { recoverPublishedAnalysis } from "../server/legacy-analysis.mjs";
import {
  coverVisualCellThreshold,
  coverVisualRevealProgress,
} from "../dist/visual/cover-reveal.js";

test("cover visual reveal begins with the title and completes with it", () => {
  assert.equal(
    coverVisualRevealProgress({
      visibleCharacters: 19,
      labelLength: 19,
      titleLength: 20,
    }),
    0,
  );
  assert.equal(
    coverVisualRevealProgress({
      visibleCharacters: 30,
      labelLength: 19,
      titleLength: 20,
    }),
    0.5,
  );
  assert.equal(
    coverVisualRevealProgress({
      visibleCharacters: 40,
      labelLength: 19,
      titleLength: 20,
    }),
    1,
  );
});

test("cover visual cell staggering is stable and spatially varied", () => {
  const input = {
    x: 0.2,
    y: -0.35,
    row: 8,
    col: 14,
    seed: 12345,
    phase: 0.7,
  };
  const first = coverVisualCellThreshold(input);
  const repeated = coverVisualCellThreshold(input);
  const neighbor = coverVisualCellThreshold({ ...input, col: 15 });

  assert.equal(first, repeated);
  assert.notEqual(first, neighbor);
  assert.ok(first >= 0 && first <= 1);
  assert.ok(neighbor >= 0 && neighbor <= 1);
});

test("legacy published synthesis is recovered only for matching source text", () => {
  const markdown = [
    "---",
    'title: "A thought"',
    "---",
    "",
    "# A thought",
    "",
    "first line",
    "",
    "second line",
    "",
    "---",
    "",
    "## Afterthought",
    "",
    "A saved local-model reflection.",
  ].join("\n");

  assert.deepEqual(
    recoverPublishedAnalysis(markdown, {
      title: "A thought",
      text: "first line\n\nsecond line",
    }),
    {
      reflection: "A saved local-model reflection.",
      sourceHeading: "Afterthought",
    },
  );

  assert.equal(
    recoverPublishedAnalysis(markdown, {
      title: "A thought",
      text: "edited text",
    }),
    null,
  );
});

test("current published synthesis recovery excludes the trace section", () => {
  const markdown = [
    "# A thought",
    "",
    "source",
    "",
    "## Local model note",
    "",
    "Recovered reflection.",
    "",
    "## Local model trace",
    "",
    "```json",
    "{}",
    "```",
  ].join("\n");

  assert.equal(
    recoverPublishedAnalysis(markdown, {
      title: "A thought",
      text: "source",
    })?.reflection,
    "Recovered reflection.",
  );
});

test("local AI model IDs are explicit and blank IDs are rejected", () => {
  assert.equal(
    AI_MODELS.synthesisModel,
    "onnx-community/Llama-3.2-3B-Instruct-ONNX",
  );
  assert.equal(
    AI_MODELS.embeddingModel,
    "mixedbread-ai/mxbai-embed-xsmall-v1",
  );
  assert.throws(
    () => requireLocalModelId("text-generation", ""),
    /No local text-generation model is configured/,
  );
});

test("analysis policy never treats publishing as an implicit analysis request", () => {
  assert.deepEqual(getAnalysisPolicy({ machineAnalysis: null }), {
    hasSavedAnalysis: false,
    analysisButtonLabel: "ANALYSIS",
    confirmAnalysisReplacement: false,
    confirmPublishWithoutAnalysis: true,
  });
});

test("analysis policy reuses saved analysis and protects replacement", () => {
  assert.deepEqual(getAnalysisPolicy({ machineAnalysis: { synthesis: {} } }), {
    hasSavedAnalysis: true,
    analysisButtonLabel: "RE-ANALYZE",
    confirmAnalysisReplacement: true,
    confirmPublishWithoutAnalysis: false,
  });
});

test("thought Markdown round-trips metadata and exact body whitespace", () => {
  const record = {
    id: "thought-id",
    index: 7,
    title: 'A title: with "quotes"',
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T01:00:00.000Z",
    typingMs: 1234,
    visualSeed: 987,
    text: "\nFirst line\n\nLast line",
  };

  const { meta, text } = parseThought(serializeThought(record));

  assert.equal(meta.id, record.id);
  assert.equal(meta.index, record.index);
  assert.equal(meta.title, record.title);
  assert.equal(meta.typing_ms, record.typingMs);
  assert.equal(meta.visual_seed, record.visualSeed);
  assert.equal(text, record.text);
  assert.equal(thoughtFilename(record.index), "007.md");
});

test("plain Markdown without frontmatter remains untouched", () => {
  const markdown = "first\n\nsecond\n";
  assert.deepEqual(parseThought(markdown), { meta: {}, text: markdown });
});

test("publication names are stable and filesystem-safe", () => {
  assert.equal(slugify("  Cosmic / Trace: #1  "), "cosmic-trace-1");
  assert.equal(publicationPrefix(4), "thought-004-");
  assert.equal(
    publicationDirectoryName(4, "Cosmic / Trace"),
    "thought-004-cosmic-trace",
  );
  assert.equal(pageName(3), "03");
  assert.equal(pageName(0), null);
  assert.equal(pageName("nope"), null);
});

test("atomic writers replace complete files without leaving temp files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gt-atomic-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const jsonFile = path.join(directory, "index.json");
  const textFile = path.join(directory, "thought.md");

  await writeJSONAtomic(jsonFile, { value: 1 });
  await writeJSONAtomic(jsonFile, { value: 2 });
  await writeTextAtomic(textFile, "complete text");

  assert.deepEqual(await readJSON(jsonFile, null), { value: 2 });
  assert.equal(await fs.readFile(textFile, "utf8"), "complete text");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["index.json", "thought.md"]);
});
