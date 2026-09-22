import { CANVAS } from "./config.js";

import { pad } from "./helpers.js";
import {
  publishImagePercent,
  publishVideoPercent,
} from "./publish-progress.js";

import { buildSlides, drawSlide, getPublishAnimationPlan } from "./visuals.js";
import { publicationVideoTiming } from "./video-timing.js";

/* =========================================================
   EXPORT SETTINGS
   ========================================================= */

const IMAGE_QUALITY = 0.96;

const VIDEO_FPS = 30;

const VIDEO_BITRATE = 6_000_000;

/* =========================================================
   STATE
   ========================================================= */

function activeNumber(state) {
  return state.currentIndex || state.nextIndex || 1;
}

function activeId(state) {
  return state.currentId || state.id || null;
}

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

/* =========================================================
   CANVAS -> BLOB
   ========================================================= */

function canvasToBlob(canvas, quality = IMAGE_QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not render published image."));

          return;
        }

        resolve(blob);
      },

      "image/jpeg",

      quality,
    );
  });
}

/* =========================================================
   BLOB -> DATA URL
   ========================================================= */

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(reader.error || new Error("Could not encode published media."));
    };

    reader.readAsDataURL(blob);
  });
}

/* =========================================================
   STATIC IMAGE
   ========================================================= */

async function renderImage(state, index, graphics) {
  clearPublishReveal(state);

  drawSlide(index, state, graphics);

  return canvasToBlob(graphics.canvas);
}

/* =========================================================
   PUBLISH REVEAL STATE

   visuals.js reads this object while
   drawSlide() is rendering a video frame.
   ========================================================= */

function setPublishReveal(state, index, visibleCharacters, totalCharacters) {
  state.__publishReveal = {
    active: true,

    slideIndex: index,

    visibleCharacters,

    totalCharacters,

    progress: clamp(
      visibleCharacters / Math.max(1, totalCharacters),

      0,

      1,
    ),
  };
}

function clearPublishReveal(state) {
  delete state.__publishReveal;
}

function snapshotCanvas(canvas) {
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext("2d").drawImage(canvas, 0, 0);
  return snapshot;
}

async function holdRenderedFrame(
  durationMs,
  canvas,
  snapshot,
  emitFrame,
  onProgress = () => {},
) {
  const context = canvas.getContext("2d");
  const startedAt = performance.now();

  while (performance.now() - startedAt < durationMs) {
    context.drawImage(snapshot, 0, 0);
    emitFrame();
    onProgress(clamp((performance.now() - startedAt) / durationMs, 0, 1));
    await nextFrame();
  }

  context.drawImage(snapshot, 0, 0);
  emitFrame();
  onProgress(1);
}

/* =========================================================
   MEDIA RECORDER
   ========================================================= */

function preferredVideoMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

/* =========================================================
   RECORD ONE TYPING VIDEO
   ========================================================= */

async function recordTypingVideo(
  state,
  index,
  graphics,
  animationPlan,
  onProgress = () => {},
) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support MediaRecorder.");
  }

  const canvas = graphics.canvas;

  if (!canvas || typeof canvas.captureStream !== "function") {
    throw new Error("This browser cannot record the publication canvas.");
  }

  const mimeType = preferredVideoMimeType();
  const totalCharacters = animationPlan.totalCharacters;
  const timing = publicationVideoTiming({
    type: animationPlan.type,
    totalCharacters,
  });
  let lastProgressPercent = -1;

  const reportProgress = (elapsedMs, phase) => {
    const progress = clamp(elapsedMs / timing.totalMs, 0, 1);
    const percent = Math.floor(progress * 100);

    if (percent <= lastProgressPercent && progress < 1) return;
    lastProgressPercent = percent;
    onProgress({ progress, phase });
  };

  const stream = canvas.captureStream(VIDEO_FPS);
  const videoTrack = stream.getVideoTracks()[0] || null;
  const emitFrame = () => videoTrack?.requestFrame?.();

  const options = {
    videoBitsPerSecond: VIDEO_BITRATE,
  };

  if (mimeType) {
    options.mimeType = mimeType;
  }

  const recorder = new MediaRecorder(stream, options);

  const chunks = [];

  const stopped = new Promise((resolve, reject) => {
    recorder.addEventListener(
      "dataavailable",

      (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      },
    );

    recorder.addEventListener(
      "stop",

      resolve,

      {
        once: true,
      },
    );

    recorder.addEventListener(
      "error",

      (event) => {
        reject(event.error || new Error("Video recording failed."));
      },

      {
        once: true,
      },
    );
  });

  /*
    Draw the empty / zero-character state
    BEFORE starting the recorder.
  */

  setPublishReveal(state, index, 0, totalCharacters);

  drawSlide(index, state, graphics);
  const emptyFrame = snapshotCanvas(canvas);

  recorder.start(250);

  try {
    /*
      Brief stillness before typing begins.
    */

    await holdRenderedFrame(
      timing.startHoldMs,
      canvas,
      emptyFrame,
      emitFrame,
      (progress) => {
        reportProgress(progress * timing.startHoldMs, "starting");
      },
    );

    const startedAt = performance.now();

    while (true) {
      const elapsed = performance.now() - startedAt;

      const progress = clamp(
        elapsed / timing.typingMs,

        0,

        1,
      );

      const visibleCharacters = Math.min(
        totalCharacters,

        Math.floor(totalCharacters * progress),
      );

      setPublishReveal(state, index, visibleCharacters, totalCharacters);

      drawSlide(index, state, graphics);
      emitFrame();
      reportProgress(timing.startHoldMs + elapsed, "typing");

      if (progress >= 1) {
        break;
      }

      await nextFrame();
    }

    /*
      Guarantee one completely finished frame.
    */

    setPublishReveal(state, index, totalCharacters, totalCharacters);
    drawSlide(index, state, graphics);
    emitFrame();

    const completedFrame = snapshotCanvas(canvas);

    await holdRenderedFrame(
      timing.endHoldMs,
      canvas,
      completedFrame,
      emitFrame,
      (progress) => {
        reportProgress(
          timing.startHoldMs + timing.typingMs + progress * timing.endHoldMs,
          "holding",
        );
      },
    );

    recorder.stop();

    await stopped;
  } finally {
    clearPublishReveal(state);

    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  const blob = new Blob(
    chunks,

    {
      type: recorder.mimeType || mimeType || "video/webm",
    },
  );

  if (!blob.size) {
    throw new Error(`Slide ${index + 1} produced an empty video.`);
  }

  return blob;
}

/* =========================================================
   MARKDOWN
   ========================================================= */

function publicationMarkdown(state) {
  if (typeof state.markdown === "string" && state.markdown.trim()) {
    return state.markdown;
  }

  const title = String(state.title || "").trim();

  const text = String(state.text || "").trim();

  const output = [];

  if (title) {
    output.push(`# ${title}`);
  }

  if (text) {
    output.push(text);
  }

  if (!output.length) {
    output.push(`# Generative Thought ${pad(activeNumber(state))}`);
  }

  const reflection = String(
    state.machineAnalysis?.synthesis?.reflection || "",
  ).trim();

  if (reflection) {
    output.push("## Local model note", reflection);
  }

  const trace = state.machineAnalysis?.trace || null;

  if (trace) {
    output.push(
      "## Local model trace",
      "```json",
      JSON.stringify(
        {
          trace,
          modelProvenance: state.machineAnalysis?.modelProvenance || null,
        },
        null,
        2,
      ),
      "```",
    );
  }

  return `${output.join("\n\n")}\n`;
}

/* =========================================================
   SEND TO LOCAL PUBLISH SERVER
   ========================================================= */

async function savePublicationToServer(state, images, videos) {
  const id = activeId(state);

  if (!id) {
    throw new Error(
      "Save this thought before publishing so it has a permanent ID.",
    );
  }

  const response = await fetch(
    "/api/publish",

    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        id,

        index: activeNumber(state),

        title: String(state.title || ""),

        markdown: publicationMarkdown(state),

        images,

        videos,
      }),
    },
  );

  let result = null;

  try {
    result = await response.json();
  } catch {
    /*
      Keep the fallback error below.
    */
  }

  if (!response.ok) {
    throw new Error(result?.error || `Publish failed (${response.status}).`);
  }

  return result;
}

/* =========================================================
   PUBLISH

   Result:

   cover
     01.jpg
     01.mp4 (typed cover)

   human writing pages
     02.jpg
     03.jpg
     ...

   AI synthesis pages
     04.jpg + 04.mp4
     05.jpg + 05.mp4
     ...
   ========================================================= */

export async function publishCarousel(state, onProgress = () => {}) {
  if (!state?.p5) {
    throw new Error("Canvas is not ready for publishing.");
  }

  const graphics = state.p5.createGraphics(CANVAS.width, CANVAS.height);

  graphics.pixelDensity(1);
  onProgress({ label: "PREPARING PUBLICATION", percent: 2 });

  /*
    VERY IMPORTANT:

    Rebuild from the latest:
    - writing
    - AI reflection
    - local trace

    instead of trusting potentially stale preview slides.
  */

  buildSlides(state, graphics);

  if (!Array.isArray(state.slides) || !state.slides.length) {
    graphics.remove();

    throw new Error("Nothing is available to publish.");
  }

  const images = [];

  const videos = [];
  const videoPlans = state.slides
    .map((slide, index) => ({
      index,
      plan: getPublishAnimationPlan(index, state),
    }))
    .filter(({ plan }) => plan.animate);

  try {
    for (let index = 0; index < state.slides.length; index += 1) {
      onProgress({
        label: `RENDERING JPG ${index + 1} OF ${state.slides.length}`,
        percent: publishImagePercent(index, state.slides.length),
      });
      const blob = await renderImage(state, index, graphics);

      images.push({
        page: index + 1,
        data: await blobToDataURL(blob),
      });

      onProgress({
        label: `RENDERING JPG ${index + 1} OF ${state.slides.length}`,
        percent: publishImagePercent(index + 1, state.slides.length),
      });
    }

    for (let videoIndex = 0; videoIndex < videoPlans.length; videoIndex += 1) {
      const { index, plan } = videoPlans[videoIndex];
      const blob = await recordTypingVideo(
        state,
        index,
        graphics,
        plan,
        ({ progress, phase }) => {
          onProgress({
            label:
              phase === "holding"
                ? `FINAL HOLD · MP4 ${videoIndex + 1} OF ${videoPlans.length}`
                : `RENDERING MP4 ${videoIndex + 1} OF ${videoPlans.length}`,
            percent: publishVideoPercent(
              videoIndex,
              progress,
              videoPlans.length,
            ),
          });
        },
      );

      videos.push({
        page: index + 1,
        data: await blobToDataURL(blob),
      });
    }

    onProgress({ label: "CONVERTING & SAVING FILES", percent: 92 });
    const result = await savePublicationToServer(state, images, videos);
    onProgress({ label: "PUBLICATION COMPLETE", percent: 100 });
    return result;
  } finally {
    clearPublishReveal(state);
    graphics.remove();

    if (state.p5) {
      buildSlides(state, state.p5);
      drawSlide(state.slideIndex, state, state.p5);
    }
  }
}
