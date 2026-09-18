import plexMonoUrl from "@ibm/plex-mono/fonts/split/woff2/IBMPlexMono-Regular-Latin1.woff2?url";

export const PRINT_FONT = "IBM Plex Mono";

const style = document.createElement("style");
style.textContent = `
  @font-face {
    font-family: "${PRINT_FONT}";
    src: url("${plexMonoUrl}") format("woff2");
    font-style: normal;
    font-weight: 400;
    font-display: swap;
  }
`;
document.head.append(style);

export const printFontReady = document.fonts.load(`16px "${PRINT_FONT}"`);

export const STORAGE = {
  draft: "generative-thoughts.draft.v7",
};

export const CANVAS = {
  width: 1080,
  height: 1350,
};

export const PALETTE = {
  background: "#e8dfcf",
  text: "#514b43",
  art: "#3c3731",
  dim: "#756d63",
};

export const LAYOUT = {
  margin: 72,
  left: 72,
  top: 72,
  right: 1008,
  bottom: 1278,
  width: 936,
  height: 1206,
  coverArtTop: 174,
  coverArtBottom: 1048,
  coverTitleY: 1126,
};

export const TYPE = {
  size: 34,
  leading: 1.5,
};

export const TYPING_PAUSE_MS = 5000;
export const AUTO_SAVE_MS = 900;
export const AUTO_ANALYZE_MS = 7000;

export const AI = {
  embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1",
  synthesisModel: "onnx-community/Qwen3-0.6B-Instruct-ONNX",
};
