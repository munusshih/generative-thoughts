import { AI } from "./config.js";

let extractor = null;
let generator = null;
let loadingPromise = null;

function deviceChoice() {
  return "gpu" in navigator ? "webgpu" : "wasm";
}

function cleanJSON(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function fallbackSynthesis() {
  return {
    recurring_concepts: [],
    tensions: [],
    movement: "",
    undercurrent: "",
  };
}

async function loadPipeline(kind, model, onProgress) {
  const { pipeline } = await import("@huggingface/transformers");
  const preferredDevice = deviceChoice();

  try {
    return await pipeline(kind, model, {
      device: preferredDevice,
      dtype: preferredDevice === "webgpu" ? "q4f16" : "q4",
      progress_callback: onProgress,
    });
  } catch (error) {
    if (preferredDevice === "wasm") throw error;

    return pipeline(kind, model, {
      device: "wasm",
      dtype: "q4",
      progress_callback: onProgress,
    });
  }
}

export async function ensureModels(onProgress = () => {}) {
  if (extractor && generator) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    if (!extractor) {
      extractor = await loadPipeline(
        "feature-extraction",
        AI.embeddingModel,
        onProgress
      );
    }

    if (!generator) {
      generator = await loadPipeline(
        "text-generation",
        AI.synthesisModel,
        onProgress
      );
    }
  })();

  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

function extractGeneratedText(result) {
  const generated = result?.[0]?.generated_text;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return last?.content || "";
  }
  return typeof generated === "string" ? generated : "";
}

export async function analyzeLocally(title, text, onProgress = () => {}) {
  await ensureModels(onProgress);

  const source = `${title}\n${text}`.trim().slice(0, 12000);

  const embeddingResult = await extractor(source, {
    pooling: "mean",
    normalize: true,
  });

  const embedding = Array.from(embeddingResult.data);
  const note = String(text || "").slice(0, 9000);

  const messages = [
    {
      role: "system",
      content:
        "You are a perceptive human reader. Be gentle, observant, and grounded in the actual writing. Do not give advice. Do not diagnose. Do not sound clinical. Return JSON only.",
    },
    {
      role: "user",
      content: `Read the note below and return exactly this JSON shape:
{
  "recurring_concepts": ["maximum 5 short phrases"],
  "tensions": ["maximum 3 concise A / B tensions"],
  "movement": "one sentence, maximum 24 words, sounding natural and human",
  "undercurrent": "one brief sentence, maximum 18 words, naming a subtle emotional or conceptual undercurrent"
}

Only include patterns that are clearly supported by the note.

TITLE:
${title}

NOTE:
${note}`,
    },
  ];

  const result = await generator(messages, {
    max_new_tokens: 240,
    do_sample: false,
  });

  let synthesis = fallbackSynthesis();

  try {
    synthesis = {
      ...synthesis,
      ...JSON.parse(cleanJSON(extractGeneratedText(result))),
    };
  } catch {}

  return {
    embedding,
    synthesis,
    embeddingModel: AI.embeddingModel,
    synthesisModel: AI.synthesisModel,
  };
}

export function warmModels(onProgress = () => {}) {
  return ensureModels(onProgress);
}
