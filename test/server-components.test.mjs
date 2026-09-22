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
  openSystemTarget,
  systemOpenCommand,
} from "../server/system-open.mjs";
import {
  pageName,
  publicationDirectoryName,
  publicationPrefix,
  slugify,
} from "../server/publication-naming.mjs";
import { getAnalysisPolicy } from "../dist/studio/analysis-policy.js";
import {
  analysisProgressView,
  initialAnalysisProgress,
} from "../dist/studio/analysis-progress.js";
import {
  AI_MODELS,
  requireLocalModelId,
} from "../dist/model-config.js";
import { recoverPublishedAnalysis } from "../server/legacy-analysis.mjs";
import {
  coverVisualCellThreshold,
  coverVisualRevealProgress,
} from "../dist/visual/cover-reveal.js";
import {
  createServerConnection,
  createServerUnavailableError,
  isServerUnavailable,
} from "../dist/studio/server-connection.js";

test("server connection reports once and recovers through its scheduled probe", async () => {
  const scheduled = [];
  const events = [];
  const connection = createServerConnection({
    probe: async () => events.push("probe"),
    onDisconnected: () => events.push("disconnected"),
    onReconnected: async () => events.push("reconnected"),
    setTimeoutFn(callback) {
      scheduled.push(callback);
      return scheduled.length;
    },
    clearTimeoutFn() {},
  });

  const unavailable = createServerUnavailableError(new TypeError("Failed to fetch"));
  assert.equal(isServerUnavailable(unavailable), true);
  assert.equal(connection.report(unavailable), true);
  assert.equal(connection.report(unavailable), true);
  assert.equal(connection.report(new Error("ordinary failure")), false);
  assert.equal(connection.disconnected, true);
  assert.deepEqual(events, ["disconnected"]);
  assert.equal(scheduled.length, 1);

  await scheduled[0]();

  assert.equal(connection.disconnected, false);
  assert.deepEqual(events, ["disconnected", "probe", "reconnected"]);
});

test("successful publication folders use the native system opener", () => {
  assert.deepEqual(systemOpenCommand("/tmp/published", "darwin"), {
    command: "open",
    args: ["/tmp/published"],
  });
  assert.deepEqual(systemOpenCommand("C:\\published", "win32"), {
    command: "cmd",
    args: ["/c", "start", "", "C:\\published"],
  });

  const launches = [];
  openSystemTarget("/tmp/published", {
    platform: "darwin",
    launch(command, args, callback) {
      launches.push({ command, args });
      callback(null);
    },
  });

  assert.deepEqual(launches, [
    { command: "open", args: ["/tmp/published"] },
  ]);
});

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

test("cover visual types left-to-right and line-by-line", () => {
  const first = coverVisualCellThreshold({ row: 0, col: 0, rows: 3, cols: 4 });
  const nextCharacter = coverVisualCellThreshold({
    row: 0,
    col: 1,
    rows: 3,
    cols: 4,
  });
  const nextLine = coverVisualCellThreshold({
    row: 1,
    col: 0,
    rows: 3,
    cols: 4,
  });
  const last = coverVisualCellThreshold({ row: 2, col: 3, rows: 3, cols: 4 });

  assert.equal(first, 1 / 12);
  assert.equal(nextCharacter, 2 / 12);
  assert.equal(nextLine, 5 / 12);
  assert.equal(last, 1);
  assert.ok(first < nextCharacter);
  assert.ok(nextCharacter < nextLine);
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

test("analysis progress is labeled and never moves backward", () => {
  let view = initialAnalysisProgress();
  view = analysisProgressView({ stage: "saving-draft" }, view);
  assert.deepEqual(view, { label: "SAVING WRITING", percent: 3, rank: 1 });

  view = analysisProgressView(
    { stage: "loading", pipeline: "text-generation", progress: 50 },
    view,
  );
  assert.deepEqual(view, {
    label: "LOADING SYNTHESIS MODEL",
    percent: 28,
    rank: 3,
  });

  view = analysisProgressView({ stage: "generating", percent: 50 }, view);
  assert.deepEqual(view, {
    label: "WRITING SYNTHESIS",
    percent: 71,
    rank: 4,
  });

  view = analysisProgressView(
    { stage: "loading", pipeline: "feature-extraction", progress: 100 },
    view,
  );
  assert.equal(view.label, "WRITING SYNTHESIS");
  assert.equal(view.percent, 71);

  view = analysisProgressView({ stage: "saved" }, view);
  assert.deepEqual(view, {
    label: "ANALYSIS COMPLETE",
    percent: 100,
    rank: 7,
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
