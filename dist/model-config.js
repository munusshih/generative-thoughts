export const AI_MODELS = Object.freeze({
  synthesisModel: "onnx-community/Llama-3.2-3B-Instruct-ONNX",
  embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1",
});

export function requireLocalModelId(kind, model) {
  const modelId = String(model || "").trim();

  if (!modelId) {
    throw new Error(
      `No local ${kind} model is configured. Set its model ID in dist/model-config.js.`,
    );
  }

  return modelId;
}
