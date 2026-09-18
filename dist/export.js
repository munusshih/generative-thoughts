import JSZip from "jszip";
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
} from "mediabunny";

import { CANVAS, printFontReady } from "./config.js";
import { pad } from "./helpers.js";
import { drawSlide } from "./visuals.js";

function activeNumber(state) {
  return state.currentIndex || state.nextIndex || 1;
}

function canvasToBlob(canvas, quality = 0.92) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function imageFilename(state, index) {
  return `generative-thought-${pad(activeNumber(state))}-${pad(index + 1, 2)}-${state.slides[index].type}.jpg`;
}

function videoFilename(state) {
  return `generative-thought-${pad(activeNumber(state))}-01-cover.mp4`;
}

async function renderImage(state, index, graphics) {
  drawSlide(index, state, graphics, 0);
  return canvasToBlob(graphics.canvas);
}

async function renderCoverVideo(state) {
  if (!("VideoEncoder" in window)) {
    throw new Error("MP4 encoder unavailable in this browser");
  }

  await printFontReady;

  const graphics = state.p5.createGraphics(CANVAS.width, CANVAS.height);
  graphics.pixelDensity(1);

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  });

  const source = new CanvasSource(graphics.canvas, {
    codec: "avc",
    quality: new Quality({ bitrate: 1_800_000 }),
    keyFrameInterval: 2,
    latencyMode: "quality",
  });

  const fps = 18;
  const duration = 4;
  const count = fps * duration;

  output.addVideoTrack(source, { frameRate: fps });

  try {
    await output.start();

    for (let frame = 0; frame < count; frame += 1) {
      const t = frame / fps;
      drawSlide(0, state, graphics, t);
      await source.add(t, 1 / fps, {
        keyFrame: frame % (fps * 2) === 0,
      });
    }

    source.close();
    await output.finalize();

    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    graphics.remove();
  }
}

export async function publishCarousel(state) {
  const graphics = state.p5.createGraphics(CANVAS.width, CANVAS.height);
  graphics.pixelDensity(1);

  try {
    const zip = new JSZip();
    zip.file(videoFilename(state), await renderCoverVideo(state));

    for (let index = 1; index < state.slides.length; index += 1) {
      zip.file(
        imageFilename(state, index),
        await renderImage(state, index, graphics)
      );
    }

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `generative-thought-${pad(activeNumber(state))}.zip`);
  } finally {
    graphics.remove();
  }
}
