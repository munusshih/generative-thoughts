import { AI } from "./config.js";

/* =========================================================
   TRANSFORMERS.JS
   ========================================================= */

let transformersPromise = null;

async function getTransformers() {
  if (!transformersPromise) {
    transformersPromise = import("@huggingface/transformers").then(
      (transformers) => {
        const { env, LogLevel } = transformers;

        /*
          MODELS LIVE HERE:

          public/models/

          Vite exposes that directory as:

          /models/
        */

        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = "/models/";
        env.useBrowserCache = true;

        /*
          Silence Transformers.js internal logging.
        */

        if (LogLevel && LogLevel.NONE !== undefined) {
          env.logLevel = LogLevel.NONE;
        }

        return transformers;
      },
    );
  }

  return transformersPromise;
}

/* =========================================================
   MODEL STATE
   ========================================================= */

let extractor = null;
let generator = null;

let extractorPromise = null;
let generatorPromise = null;

const runtime = {
  generator: {
    model: AI.synthesisModel,
    device: null,
    dtype: null,
    loadMs: null,
  },

  embedding: {
    model: AI.embeddingModel,
    device: null,
    dtype: null,
    loadMs: null,
  },
};

/* =========================================================
   MODEL PROVENANCE
   ========================================================= */

function getSynthesisModelProvenance(model) {
  const id = String(model || "unknown");

  if (/Llama-3\.2-3B-Instruct/i.test(id)) {
    return {
      id,
      baseModel: "meta-llama/Llama-3.2-3B-Instruct",
      developedBy: "Meta",

      webConversion: id.startsWith("onnx-community/") ? "ONNX Community" : null,

      runtime: "Hugging Face Transformers.js",
      execution: "local in the browser",
      format: "ONNX q4f16",
      license: "Llama 3.2 Community License",

      creditLine:
        "Built with Llama 3.2 3B Instruct by Meta · ONNX weights by ONNX Community · local inference with Hugging Face Transformers.js.",
    };
  }

  return {
    id,
    baseModel: null,
    developedBy: null,

    webConversion: id.startsWith("onnx-community/") ? "ONNX Community" : null,

    runtime: "Hugging Face Transformers.js",
    execution: "local in the browser",
    format: "ONNX q4f16",
    license: null,

    creditLine: `Generated locally with ${id} via Hugging Face Transformers.js.`,
  };
}

/* =========================================================
   GENERATION CONFIG
   ========================================================= */

const GENERATION_CONFIG = {
  max_new_tokens: 260,

  do_sample: true,

  /*
    Curious enough to make connections,
    but restrained enough to avoid
    jumping across too many unrelated ideas.
  */

  temperature: 0.76,
  top_p: 0.9,

  /*
    Slightly stronger repetition penalty
    because the 3B model tends to repeat
    the same curiosity in several forms.
  */

  repetition_penalty: 1.08,

  add_special_tokens: false,
  return_full_text: false,
};

/* =========================================================
   DEVICE
   ========================================================= */

function requireWebGPU() {
  if (!navigator.gpu) {
    throw new Error(
      "Generative Thoughts requires WebGPU for its local AI models.",
    );
  }

  return "webgpu";
}

function runtimeSlot(kind) {
  return kind === "text-generation" ? runtime.generator : runtime.embedding;
}

/* =========================================================
   QUIET MODEL-LOAD PROGRESS
   ========================================================= */

const loadProgressState = new Map();

function shouldForwardLoadProgress(kind, info) {
  if (info.status === "ready" || info.status === "done") {
    return true;
  }

  if (info.status !== "progress") {
    return false;
  }

  const file = info.file || "model";
  const key = `${kind}:${file}`;

  const percent = Math.floor(Number(info.progress || 0));

  const previous = loadProgressState.get(key);

  if (previous === undefined || percent === 100 || percent >= previous + 10) {
    loadProgressState.set(key, percent);

    return true;
  }

  return false;
}

/* =========================================================
   LOCAL MODEL LOADING
   ========================================================= */

async function loadLocalPipeline(kind, model, onProgress = () => {}) {
  const { pipeline } = await getTransformers();

  const device = requireWebGPU();

  /*
    Local q4f16 only.

    No remote fallback.
    No WASM fallback.
  */

  const dtype = "q4f16";

  const started = performance.now();

  onProgress({
    stage: "loading",
    pipeline: kind,
    model,
    device,
    dtype,
    local: true,
    progress: 0,
  });

  try {
    const pipe = await pipeline(kind, model, {
      device,
      dtype,

      progress_callback: (info) => {
        if (!shouldForwardLoadProgress(kind, info)) {
          return;
        }

        onProgress({
          ...info,

          stage: "loading",
          pipeline: kind,
          model,
          device,
          dtype,
          local: true,
        });
      },
    });

    const slot = runtimeSlot(kind);

    slot.model = model;
    slot.device = device;
    slot.dtype = dtype;
    slot.loadMs = performance.now() - started;

    return pipe;
  } catch (error) {
    console.error(`[AI] failed to load ${kind}`, error);

    throw new Error(
      [
        `Could not load local ${kind} model "${model}". `,
        `Make sure its q4f16 files exist under `,
        `/models/${model}/. `,
        error?.message || String(error),
      ].join(""),
    );
  }
}

/* =========================================================
   GENERATOR
   ========================================================= */

async function ensureGenerator(onProgress = () => {}) {
  if (generator) {
    return generator;
  }

  if (generatorPromise) {
    return generatorPromise;
  }

  generatorPromise = loadLocalPipeline(
    "text-generation",
    AI.synthesisModel,
    onProgress,
  );

  try {
    generator = await generatorPromise;

    return generator;
  } finally {
    generatorPromise = null;
  }
}

/* =========================================================
   EMBEDDING MODEL
   ========================================================= */

async function ensureExtractor(onProgress = () => {}) {
  if (extractor) {
    return extractor;
  }

  if (extractorPromise) {
    return extractorPromise;
  }

  extractorPromise = loadLocalPipeline(
    "feature-extraction",
    AI.embeddingModel,
    onProgress,
  );

  try {
    extractor = await extractorPromise;

    return extractor;
  } finally {
    extractorPromise = null;
  }
}

/* =========================================================
   BASIC TEXT ANALYSIS
   ========================================================= */

const STOP_WORDS = new Set(
  `
  a about after again all also am an and any are as at
  be because been before being but by
  can could
  did do does doing
  for from
  had has have having he her here hers herself him himself his how
  i if in into is it its itself
  just
  me more most my myself
  no nor not now
  of off on once only or our ours ourselves out over own
  same she should so some such
  than that the their theirs them themselves then there these they this
  those through to too
  under until up
  very
  was we were what when where which while who whom why will with would
  you your yours yourself yourselves
  `
    .trim()
    .split(/\s+/),
);

function tokenizeWords(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[’]/g, "'")
      .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []
  );
}

function splitLines(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizedWords(value) {
  return tokenizeWords(value);
}

/* =========================================================
   TOKEN-SEQUENCE MATCHING
   ========================================================= */

function tokenSequenceExists(sourceWords, targetWords) {
  if (
    !sourceWords.length ||
    !targetWords.length ||
    targetWords.length > sourceWords.length
  ) {
    return false;
  }

  for (
    let index = 0;
    index <= sourceWords.length - targetWords.length;
    index += 1
  ) {
    let matches = true;

    for (let offset = 0; offset < targetWords.length; offset += 1) {
      if (sourceWords[index + offset] !== targetWords[offset]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

/* =========================================================
   EVENLY DISTRIBUTED EXAMPLES
   ========================================================= */

function selectEvenly(items, maxItems = 4) {
  if (items.length <= maxItems) {
    return items;
  }

  if (maxItems <= 1) {
    return [items[0]];
  }

  const indices = new Set();

  for (let slot = 0; slot < maxItems; slot += 1) {
    const position = Math.round((slot / (maxItems - 1)) * (items.length - 1));

    indices.add(position);
  }

  return [...indices].sort((a, b) => a - b).map((index) => items[index]);
}

/* =========================================================
   REPEATED WORDS
   ========================================================= */

function countRepeatedWords(words) {
  const counts = new Map();

  for (const word of words) {
    if (word.length < 3 || STOP_WORDS.has(word)) {
      continue;
    }

    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([word, count]) => ({
      word,
      count,
    }));
}

function wordPositions(words, target) {
  const positions = [];

  for (let index = 0; index < words.length; index += 1) {
    if (words[index] === target) {
      positions.push(index);
    }
  }

  return positions;
}

/* =========================================================
   LOCAL CONTEXT COLLECTION
   ========================================================= */

function collectLineContexts(source, target, maxContexts = 4) {
  const lines = splitLines(source);

  const targetWords = normalizedWords(target);

  if (!targetWords.length) {
    return [];
  }

  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineWords = normalizedWords(lines[index]);

    if (!tokenSequenceExists(lineWords, targetWords)) {
      continue;
    }

    const previous = lines[index - 1] || "";

    const current = lines[index] || "";

    const next = lines[index + 1] || "";

    const context = [previous, current, next].filter(Boolean).join(" / ");

    if (context && !matches.some((item) => item.context === context)) {
      matches.push({
        index,
        context,
      });
    }
  }

  return selectEvenly(matches, maxContexts).map(({ context }) => context);
}

/* =========================================================
   REPEATED PHRASES
   ========================================================= */

function countRepeatedPhrasesInLines(source, size) {
  const counts = new Map();

  const lines = splitLines(source);

  for (const line of lines) {
    const words = tokenizeWords(line);

    if (words.length < size) {
      continue;
    }

    for (let index = 0; index <= words.length - size; index += 1) {
      const phraseWords = words.slice(index, index + size);

      const meaningful = phraseWords.filter(
        (word) => !STOP_WORDS.has(word) && word.length >= 3,
      );

      if (meaningful.length < Math.max(1, Math.floor(size / 2))) {
        continue;
      }

      const phrase = phraseWords.join(" ");

      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([phrase, count]) => ({
      phrase,
      count,
      words: size,
    }));
}

function collectRepeatedPhrases(source) {
  const candidates = [
    ...countRepeatedPhrasesInLines(source, 6),

    ...countRepeatedPhrasesInLines(source, 5),

    ...countRepeatedPhrasesInLines(source, 4),

    ...countRepeatedPhrasesInLines(source, 3),

    ...countRepeatedPhrasesInLines(source, 2),
  ].sort(
    (a, b) =>
      b.count - a.count ||
      b.words - a.words ||
      a.phrase.localeCompare(b.phrase),
  );

  const output = [];

  for (const item of candidates) {
    const redundant = output.some((existing) => {
      if (existing.phrase === item.phrase) {
        return true;
      }

      if (
        existing.count === item.count &&
        existing.phrase.includes(item.phrase)
      ) {
        return true;
      }

      return false;
    });

    if (!redundant) {
      output.push(item);
    }

    if (output.length >= 8) {
      break;
    }
  }

  return output;
}

/* =========================================================
   REPEATED-LINE CONTINUATIONS
   ========================================================= */

function collectContinuations(source, phrase, maxContexts = 5) {
  const lines = splitLines(source);

  const phraseWords = normalizedWords(phrase);

  if (!phraseWords.length) {
    return [];
  }

  const matches = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const lineWords = normalizedWords(lines[index]);

    const exactLine =
      lineWords.length === phraseWords.length &&
      lineWords.every((word, wordIndex) => word === phraseWords[wordIndex]);

    if (!exactLine) {
      continue;
    }

    const continuation = lines[index + 1];

    if (continuation && !matches.some((item) => item.text === continuation)) {
      matches.push({
        index,
        text: continuation,
      });
    }
  }

  return selectEvenly(matches, maxContexts).map(({ text }) => text);
}

/* =========================================================
   QUESTIONS / OPENING / ENDING
   ========================================================= */

function extractQuestions(source) {
  return splitLines(source)
    .filter((line) => line.includes("?"))
    .slice(0, 6);
}

function createOpeningExcerpt(source, count = 4) {
  return splitLines(source).slice(0, count).join(" / ");
}

function createClosingExcerpt(source, count = 5) {
  return splitLines(source).slice(-count).join(" / ");
}

/* =========================================================
   VERIFIED TEXTUAL PATTERNS
   ========================================================= */

function analyzeWritingFacts(noteText) {
  const source = String(noteText || "");

  const words = tokenizeWords(source);

  const repeatedWords = countRepeatedWords(words)
    .map((item) => {
      const positions = wordPositions(words, item.word);

      const first = positions[0] ?? 0;

      const last = positions[positions.length - 1] ?? first;

      const spread =
        positions.length > 1 && words.length > 1
          ? (last - first) / (words.length - 1)
          : 0;

      const score = Math.log2(item.count + 1) + spread * 1.5;

      return {
        ...item,

        positions,
        spread,
        score,

        contexts: collectLineContexts(source, item.word, 4),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || b.count - a.count || a.word.localeCompare(b.word),
    )
    .slice(0, 8);

  const repeatedPhrases = collectRepeatedPhrases(source)
    .map((item) => ({
      ...item,

      contexts: collectLineContexts(source, item.phrase, 4),

      continuations: collectContinuations(source, item.phrase, 5),
    }))
    .slice(0, 6);

  return {
    repeatedWords,
    repeatedPhrases,

    questions: extractQuestions(source),

    openingExcerpt: createOpeningExcerpt(source),

    closingExcerpt: createClosingExcerpt(source),
  };
}

/* =========================================================
   FORMAT PATTERNS
   ========================================================= */

function formatVerifiedFacts(facts) {
  const sections = [];

  const usefulPhrases = (facts.repeatedPhrases || [])
    .filter(
      ({ contexts, continuations }) =>
        contexts?.length || continuations?.length,
    )
    .slice(0, 2);

  if (usefulPhrases.length) {
    const phrases = usefulPhrases
      .map(({ phrase, count, contexts = [], continuations = [] }) => {
        let output = `"${phrase}" — ` + `${count} occurrences`;

        if (continuations.length >= 2) {
          output += "\nDifferent continuations:";

          output +=
            "\n" +
            continuations
              .slice(0, 3)
              .map((line) => `  - "${line}"`)
              .join("\n");
        } else if (contexts.length) {
          output += "\nAppears around:";

          output +=
            "\n" +
            contexts
              .slice(0, 2)
              .map((context) => `  - "${context}"`)
              .join("\n");
        }

        return output;
      })
      .join("\n\n");

    sections.push(`RECURRING LANGUAGE:\n${phrases}`);
  }

  const usefulWords = (facts.repeatedWords || [])
    .filter(({ contexts }) => contexts?.length)
    .slice(0, 2);

  if (usefulWords.length) {
    const words = usefulWords
      .map(({ word, count, contexts = [] }) => {
        let output = `"${word}" — ` + `${count} occurrences`;

        if (contexts.length) {
          output += "\nAppears around:";

          output +=
            "\n" +
            contexts
              .slice(0, 2)
              .map((context) => `  - "${context}"`)
              .join("\n");
        }

        return output;
      })
      .join("\n\n");

    sections.push(`WORDS THAT RETURN:\n${words}`);
  }

  if (facts.questions?.length) {
    sections.push(
      `QUESTIONS ALREADY PRESENT:\n${facts.questions
        .slice(0, 3)
        .map((question) => `- "${question}"`)
        .join("\n")}`,
    );
  }

  if (facts.openingExcerpt) {
    sections.push(`OPENING:\n"${facts.openingExcerpt}"`);
  }

  if (facts.closingExcerpt) {
    sections.push(`ENDING:\n"${facts.closingExcerpt}"`);
  }

  return sections.length
    ? sections.join("\n\n")
    : "No especially strong recurring formal pattern was detected.";
}

/* =========================================================
   SEEDED CURIOSITY VARIATION
   ========================================================= */

function hashString(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);

    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mixSeed(seed, salt) {
  let value = seed ^ salt;

  value = Math.imul(value ^ (value >>> 16), 2246822507);

  value = Math.imul(value ^ (value >>> 13), 3266489909);

  return (value ^ (value >>> 16)) >>> 0;
}

function pickFromSeed(items, seed, salt) {
  const mixed = mixSeed(seed, salt);

  return items[mixed % items.length];
}

function getReadingDisposition(title, note) {
  const seed = hashString(`${title}\n${note}`);

  const curiosities = [
    `
Follow something that unexpectedly resembles another idea, theory, history,
practice, artwork, technology, or cultural example.
`,

    `
Follow one detail that makes a larger social, technological, political,
historical, or cultural question appear.
`,

    `
Follow a word, metaphor, image, or distinction that becomes stranger
the longer it is considered.
`,

    `
Bring one neighboring piece of knowledge into the conversation and see
what new question appears when it sits beside the author's writing.
`,

    `
Notice one assumption and become curious about an exception, reversal,
counterexample, or edge case.
`,

    `
Follow something that seems familiar, then ask where the resemblance
breaks or becomes more complicated.
`,

    `
Notice something the writing treats as ordinary and become curious about
the history, system, convention, or infrastructure that makes it ordinary.
`,
  ];

  return {
    curiosity: pickFromSeed(curiosities, seed, 11),
  };
}

/* =========================================================
   GENERATIVE READING PROMPT
   ========================================================= */

function buildGenerativeMessages(title, note, facts) {
  const evidence = formatVerifiedFacts(facts);

  const disposition = getReadingDisposition(title, note);

  const system = `
You are the local generative machine inside a writing system called Generative Thoughts.

The supplied writing was written by another person.

That person is the author.

The model is not the author.

Never speak as though the model wrote, experienced, remembered, felt,
believed, or intended anything in the author's writing.

Never use first-person singular:

"I"
"me"
"my"
"mine"
"myself"

Avoid:

"we"
"us"
"our"

when those words blur the author, reader, and model together.

Your role is not to critique the writing.

Your role is not to summarize it.

Your role is not to explain what it means.

Your role is not to produce the best interpretation.

Your role is to become curious about something in it.

Read like someone who has encountered many ideas, theories, histories,
technologies, artworks, cultural examples, strange facts, and other writing,
and enjoys discussing connections when something brings one to mind.

Do not try to connect everything.

Usually follow ONE particularly interesting connection.

A second connection is welcome only when it grows naturally from the first.

Stay with an interesting connection long enough for curiosity to develop.

Do not rapidly jump between many unrelated theories, examples, names,
histories, or scales.

Prefer depth of curiosity over quantity of references.

A useful movement is:

notice something

→ become curious about it

→ bring in one relevant neighbor

→ explore why the resemblance is interesting

→ ask what changes when the two things are put beside each other

→ leave something open

Outside knowledge is welcome.

A neighboring connection may be:

- a theory
- a concept
- a historical precedent
- a technological example
- an artwork
- another writing practice
- a cultural reference
- a linguistic idea
- a scientific idea
- a social structure
- a political structure
- an everyday behavior
- a widely known anecdote
- a strange fact
- an analogy
- an edge case
- a counterexample

Do not introduce a reference simply to appear knowledgeable.

Named references are optional.

A simple conceptual connection can be more useful than a famous name.

The machine may speculate about possible intellectual relatives.

It may say things such as:

"this recalls..."

"this is similar to..."

"this is very similar to..."

"there is something here that resembles..."

"this feels adjacent to..."

"this makes one wonder whether the author has read..."

"this makes one wonder if the author has encountered..."

"maybe the author is inspired by..."

"perhaps there is a connection here to..."

These are speculative associations.

They are not claims about the author's biography.

Never state that the author definitely:

read,
borrowed from,
was influenced by,
was inspired by,
responded to,
or referenced

another person, book, theory, artwork, project, or history unless the
author explicitly says so.

If suggesting a possible influence, keep the uncertainty visible.

Curiosity should be noticeable.

Ask 2 or 3 genuine questions.

The questions should emerge from the discussion.

Do not turn the response into a questionnaire.

Do not ask a question after every sentence.

Do not ask three versions of the same question.

A question might appear because:

a resemblance becomes strange,

a theory changes the scale,

an example complicates an assumption,

a historical precedent makes something seem less new,

or a comparison begins to break.

Do not immediately answer every question.

At least one question should remain open.

The response may contain statements.

Those statements should sound provisional and discussable,
not final or authoritative.

Curiosity should come from the movement of thought.

Avoid generic enthusiasm such as:

"This is fascinating!"

"This is exciting!"

"This is powerful!"

"This is important!"

"What an interesting idea!"

"This raises important questions."

Do not praise the author.

Do not congratulate the writing.

Do not rank or evaluate the writing.

Do not suggest revisions.

Do not tell the author how to improve it.

Do not determine what the writing "really means."

Do not summarize the author's argument.

Do not end with a conclusion.

External factual knowledge must be used carefully.

Never invent:

- quotations
- statistics
- dates
- people
- titles
- studies
- institutions
- historical events
- anecdotes
- factual relationships

If unsure about a specific factual detail, make the connection more general.

If unsure whether a particular thinker, work, or theory is actually relevant,
do not force the name into the response.

For this writing, use this curiosity:

${disposition.curiosity}

Write about 100 to 150 words.

Use one or two short paragraphs.

Ask 2 or 3 genuine questions.

Usually develop one primary connection.

A second connection is allowed only if it grows naturally from the first.

No heading.

No label.

No list.

Return only the finished prose.
`.trim();

  const user = `
TITLE:

${title || "Untitled"}

WRITING BY THE AUTHOR:

${note}

TEXTUAL PATTERNS:

${evidence}

Read this with curiosity.

Find one thing that makes the machine genuinely want to discuss something
beyond the immediate writing.

It might recall another idea, theory, history, fact, practice, technology,
artwork, cultural example, or strange neighboring case.

Follow that connection instead of collecting many references.

Let the connection generate 2 or 3 questions.

It is fine to say:

"this recalls..."

"this is similar to..."

"this makes one wonder whether the author has read..."

"maybe the author is inspired by..."

when a resemblance genuinely makes that association useful.

Keep any possible influence explicitly speculative.

Do not explain the author's writing back to the author.

Do not try to conclude what the writing means.

The goal is to give the author something nearby that makes the original
thought become curious again.

Return only the finished prose.
`.trim();

  return [
    {
      role: "system",
      content: system,
    },

    {
      role: "user",
      content: user,
    },
  ];
}

/* =========================================================
   RETRY PROMPT
   ========================================================= */

function buildRetryMessages(title, note, facts, failedText, reason) {
  const messages = buildGenerativeMessages(title, note, facts);

  messages.push({
    role: "assistant",
    content: failedText,
  });

  messages.push({
    role: "user",

    content: `
The previous response missed one requirement:

${reason}

Write it again without mentioning the previous attempt.

Keep it concise.

Stay with one primary curiosity.

Do not collect many theories or references.

Bring in one useful neighboring concept, history, example, theory, fact,
practice, or analogy if one genuinely fits.

Ask 2 or 3 questions.

The questions should grow from the connection rather than appearing as a list.

Keep at least one question unresolved.

Possible influence may be suggested, for example:

"this recalls..."

"this makes one wonder whether the author has read..."

"maybe the author is inspired by..."

but it must remain clearly speculative.

Do not use first-person singular.

Avoid "we", "us", and "our".

Do not praise.

Do not summarize.

Do not suggest revisions.

Do not conclude.

Write roughly 100 to 150 words.

Return only the new finished prose.
`.trim(),
  });

  return messages;
}

/* =========================================================
   CHAT TEMPLATE
   ========================================================= */

function applyChatTemplate(tokenizer, messages) {
  if (typeof tokenizer?.apply_chat_template !== "function") {
    throw new Error("Tokenizer does not support chat templates.");
  }

  return tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  });
}

/* =========================================================
   GENERATED TEXT CLEANUP
   ========================================================= */

function cleanGeneratedText(value) {
  let output = String(value || "");

  output = output
    .replace(/<\|begin_of_text\|>/g, "")
    .replace(/<\|end_of_text\|>/g, "")
    .replace(/<\|eot_id\|>/g, "")
    .replace(/<\|start_header_id\|>assistant<\|end_header_id\|>/g, "")
    .replace(/^assistant\s*/i, "")
    .replace(/^```(?:markdown|text)?\s*/i, "")
    .replace(/\s*```$/i, "");

  /*
    Remove accidental analytical labels.
  */

  output = output.replace(
    /^(?:analysis|reflection|interpretation|response|note|conclusion|observation|observations|hypothesis|synthesis|generative thought)\s*:\s*/gim,
    "",
  );

  output = output.replace(
    /^(?:analysis|reflection|interpretation|response|note|conclusion|observation|observations|hypothesis|synthesis|generative thought)\s*:?\s*$/gim,
    "",
  );

  return output
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractGeneratedText(result) {
  const generated = result?.[0]?.generated_text;

  if (typeof generated === "string") {
    return cleanGeneratedText(generated);
  }

  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];

    return cleanGeneratedText(last?.content || "");
  }

  return "";
}

/* =========================================================
   WORD LIMIT
   ========================================================= */

function limitWords(value, maxWords = 165) {
  const clean = String(value || "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  if (!clean) {
    return "";
  }

  const paragraphs = clean
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let usedWords = 0;

  const output = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);

    const remaining = maxWords - usedWords;

    if (remaining <= 0) {
      break;
    }

    if (words.length <= remaining) {
      output.push(paragraph);

      usedWords += words.length;

      continue;
    }

    const truncated = words
      .slice(0, remaining)
      .join(" ")
      .replace(/[,;:–—-]$/, "");

    output.push(`${truncated}…`);

    break;
  }

  return output.join("\n\n");
}

/* =========================================================
   VALIDATE GENERATED READING
   ========================================================= */

function validateGenerativeReading(value) {
  const text = String(value || "").trim();

  if (!text) {
    return {
      valid: false,
      reason: "empty response",
    };
  }

  const words = text.split(/\s+/).filter(Boolean);

  const sentences = text
    .split(/(?<=[.!?])(?:["'”’)]*)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const questionSentences = sentences.filter((sentence) =>
    /\?\s*["'”’)]*$/.test(sentence),
  );

  const firstPersonSingular = /\b(?:I|me|my|mine|myself)\b/i.test(text);

  const firstPersonPlural = /\b(?:we|us|our|ours|ourselves)\b/i.test(text);

  if (words.length < 85) {
    return {
      valid: false,
      reason: "response is too short",
    };
  }

  if (words.length > 175) {
    return {
      valid: false,
      reason: "response is too long",
    };
  }

  if (sentences.length < 4) {
    return {
      valid: false,
      reason: "response has too few developed sentences",
    };
  }

  if (firstPersonSingular) {
    return {
      valid: false,
      reason: "response speaks in first-person singular",
    };
  }

  if (firstPersonPlural) {
    return {
      valid: false,
      reason:
        "response merges model, author, and reader through first-person plural language",
    };
  }

  if (questionSentences.length < 2) {
    return {
      valid: false,
      reason: "response needs more curiosity",
    };
  }

  if (questionSentences.length > 4) {
    return {
      valid: false,
      reason: "response has become too question-driven",
    };
  }

  const statementSentences = sentences.length - questionSentences.length;

  if (statementSentences < 2) {
    return {
      valid: false,
      reason: "response needs more associative prose between questions",
    };
  }

  return {
    valid: true,
    reason: null,
  };
}

/* =========================================================
   TOKEN COUNT
   ========================================================= */

function countTokens(tokenizer, value) {
  try {
    if (typeof tokenizer?.encode === "function") {
      const encoded = tokenizer.encode(String(value || ""), {
        add_special_tokens: false,
      });

      if (Array.isArray(encoded) || ArrayBuffer.isView(encoded)) {
        return encoded.length;
      }

      if (encoded?.input_ids) {
        const ids = encoded.input_ids;

        if (Array.isArray(ids)) {
          return Array.isArray(ids[0]) ? ids[0].length : ids.length;
        }

        if (ids?.dims?.length) {
          return ids.dims[ids.dims.length - 1];
        }

        if (ids?.data) {
          return ids.data.length;
        }
      }

      if (encoded?.data) {
        return encoded.data.length;
      }
    }
  } catch {
    /*
      Token counts are optional.
    */
  }

  return null;
}

/* =========================================================
   SINGLE GENERATION RUN
   ========================================================= */

async function runGeneration(activeGenerator, messages, onProgress) {
  const { TextStreamer } = await getTransformers();

  const prompt = applyChatTemplate(activeGenerator.tokenizer, messages);

  const inputTokens = countTokens(activeGenerator.tokenizer, prompt);

  let generatedTokens = 0;
  let streamedText = "";

  const started = performance.now();

  let lastProgressPercent = -1;

  const emitProgress = () => {
    const percent = Math.min(
      99,

      Math.round((generatedTokens / GENERATION_CONFIG.max_new_tokens) * 100),
    );

    if (percent === lastProgressPercent) {
      return;
    }

    lastProgressPercent = percent;

    onProgress({
      stage: "generating",

      model: AI.synthesisModel,

      device: runtime.generator.device,

      dtype: runtime.generator.dtype,

      local: true,

      generatedTokens,

      maxTokens: GENERATION_CONFIG.max_new_tokens,

      percent,

      elapsedMs: performance.now() - started,

      partialText: cleanGeneratedText(streamedText),
    });
  };

  const streamer = new TextStreamer(activeGenerator.tokenizer, {
    skip_prompt: true,

    skip_special_tokens: true,

    callback_function: (text) => {
      streamedText += text;
    },

    token_callback_function: () => {
      generatedTokens += 1;

      emitProgress();
    },
  });

  onProgress({
    stage: "generating",

    model: AI.synthesisModel,

    device: runtime.generator.device,

    dtype: runtime.generator.dtype,

    local: true,

    generatedTokens: 0,

    maxTokens: GENERATION_CONFIG.max_new_tokens,

    percent: 0,

    elapsedMs: 0,

    partialText: "",
  });

  const result = await activeGenerator(prompt, {
    ...GENERATION_CONFIG,
    streamer,
  });

  const generationMs = performance.now() - started;

  const text = limitWords(extractGeneratedText(result), 165);

  return {
    text,
    generationMs,
    generatedTokens,
    inputTokens,
  };
}

/* =========================================================
   GENERATIVE THOUGHTS
   ========================================================= */

async function generateReflection(title, noteText, onProgress) {
  const note = String(noteText || "")
    .trim()
    .slice(0, 9000);

  if (!note) {
    return {
      reflection: "",
      trace: null,
    };
  }

  const activeGenerator = await ensureGenerator(onProgress);

  const facts = analyzeWritingFacts(note);

  let messages = buildGenerativeMessages(title, note, facts);

  let generation = await runGeneration(activeGenerator, messages, onProgress);

  let validation = validateGenerativeReading(generation.text);

  let retried = false;

  /*
    One retry only.
  */

  if (!validation.valid) {
    retried = true;

    onProgress({
      stage: "retrying",
      local: true,
      reason: validation.reason,
    });

    messages = buildRetryMessages(
      title,
      note,
      facts,
      generation.text,
      validation.reason,
    );

    generation = await runGeneration(activeGenerator, messages, onProgress);

    validation = validateGenerativeReading(generation.text);
  }

  const reflection = generation.text;

  if (!reflection) {
    throw new Error("Local model returned an empty generative reading.");
  }

  const outputTokens = countTokens(activeGenerator.tokenizer, reflection);

  onProgress({
    stage: "complete",

    model: AI.synthesisModel,

    device: runtime.generator.device,

    dtype: runtime.generator.dtype,

    local: true,

    generatedTokens: outputTokens ?? generation.generatedTokens,

    maxTokens: GENERATION_CONFIG.max_new_tokens,

    percent: 100,

    elapsedMs: generation.generationMs,

    partialText: reflection,
  });

  const provenance = getSynthesisModelProvenance(AI.synthesisModel);

  return {
    reflection,
    provenance,

    trace: {
      local: true,

      provenance,

      source: "repository",

      model: AI.synthesisModel,

      device: runtime.generator.device,

      dtype: runtime.generator.dtype,

      modelLoadMs: runtime.generator.loadMs,

      generationMs: generation.generationMs,

      inputTokens: generation.inputTokens,

      outputTokens,

      retried,

      valid: validation.valid,

      validationReason: validation.reason,

      temperature: GENERATION_CONFIG.temperature,

      topP: GENERATION_CONFIG.top_p,

      repetitionPenalty: GENERATION_CONFIG.repetition_penalty,

      maxNewTokens: GENERATION_CONFIG.max_new_tokens,
    },
  };
}

/* =========================================================
   EMBEDDING
   ========================================================= */

async function generateEmbedding(title, noteText, onProgress) {
  try {
    const activeExtractor = await ensureExtractor(onProgress);

    const source = `${title}\n${noteText}`.trim().slice(0, 12000);

    if (!source) {
      return {
        embedding: [],
        ms: null,
      };
    }

    const started = performance.now();

    const result = await activeExtractor(source, {
      pooling: "mean",
      normalize: true,
    });

    return {
      embedding: Array.from(result.data),

      ms: performance.now() - started,
    };
  } catch (error) {
    /*
      Embeddings should never block writing.
    */

    console.warn("[AI] embedding unavailable", error);

    return {
      embedding: [],
      ms: null,
    };
  }
}

/* =========================================================
   PUBLIC API
   ========================================================= */

export async function analyzeLocally(title, noteText, onProgress = () => {}) {
  const [synthesisResult, embeddingResult] = await Promise.all([
    generateReflection(title, noteText, onProgress),

    generateEmbedding(title, noteText, onProgress),
  ]);

  return {
    embedding: embeddingResult.embedding,

    synthesis: {
      reflection: synthesisResult.reflection,

      provenance: synthesisResult.provenance,

      creditLine: synthesisResult.provenance?.creditLine || null,
    },

    trace: {
      ...synthesisResult.trace,

      embeddingMs: embeddingResult.ms,

      embeddingModel: AI.embeddingModel,

      embeddingDevice: runtime.embedding.device,

      embeddingDtype: runtime.embedding.dtype,

      modelSource: "repository",
    },

    embeddingModel: AI.embeddingModel,

    synthesisModel: AI.synthesisModel,

    modelProvenance: synthesisResult.provenance,
  };
}

/* =========================================================
   WARM BOTH LOCAL MODELS
   ========================================================= */

export async function warmModels(onProgress = () => {}) {
  /*
    Keep these existing stage names so app.js
    does not need to change.
  */

  onProgress({
    stage: "critic-loading",
    local: true,
  });

  await ensureGenerator(onProgress);

  onProgress({
    stage: "critic-ready",
    local: true,
  });

  try {
    onProgress({
      stage: "embedding-loading",
      local: true,
    });

    await ensureExtractor(onProgress);

    onProgress({
      stage: "embedding-ready",
      local: true,
    });
  } catch {
    /*
      Embedding failure does not
      block generative reading.
    */
  }

  onProgress({
    stage: "ready",
    local: true,
  });
}
