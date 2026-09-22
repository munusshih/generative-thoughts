import http from "node:http";

import fs from "node:fs/promises";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { execFile } from "node:child_process";

import { randomUUID } from "node:crypto";

import { createServer as createViteServer } from "vite";

import {
  parseThought,
  serializeThought,
  thoughtFilename,
} from "./server/archive-format.mjs";
import {
  pageName,
  publicationDirectoryName,
  publicationPrefix,
} from "./server/publication-naming.mjs";
import {
  readJSON,
  writeJSONAtomic,
  writeTextAtomic,
} from "./server/atomic-files.mjs";
import { recoverPublishedAnalysis } from "./server/legacy-analysis.mjs";
import { openSystemTarget } from "./server/system-open.mjs";
import { AI_MODELS } from "./dist/model-config.js";

/* =========================================================
   PATHS
   ========================================================= */

const __filename = fileURLToPath(import.meta.url);

const ROOT = path.dirname(__filename);

const DIST = path.join(ROOT, "dist");

const PUBLIC = path.join(ROOT, "public");

const THOUGHTS = path.join(ROOT, "thoughts");

const DATA = path.join(ROOT, "data");

const PUBLISHED = path.join(ROOT, "published");

const INDEX = path.join(DATA, "index.json");

const HOST = "127.0.0.1";

const requestedPort = Number.parseInt(process.env.GT_PORT || "", 10);

const PORT =
  Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
    ? requestedPort
    : 9999;

const APP_URL = `http://localhost:${PORT}`;

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/* =========================================================
   ENSURE DIRECTORIES
   ========================================================= */

await fs.mkdir(THOUGHTS, {
  recursive: true,
});

await fs.mkdir(DATA, {
  recursive: true,
});

await fs.mkdir(PUBLISHED, {
  recursive: true,
});

/* =========================================================
   RESPONSES
   ========================================================= */

function sendJSON(res, status, value) {
  const body = JSON.stringify(value);

  res.writeHead(
    status,

    {
      "Content-Type": "application/json; charset=utf-8",

      "Content-Length": Buffer.byteLength(body),

      "Cache-Control": "no-store",
    },
  );

  res.end(body);
}

/* =========================================================
   EXEC FILE
   ========================================================= */

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        maxBuffer: 1024 * 1024 * 20,
        ...options,
      },

      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;

          reject(error);

          return;
        }

        resolve({
          stdout,
          stderr,
        });
      },
    );
  });
}

/* =========================================================
   FFMPEG
   ========================================================= */

let ffmpegChecked = false;

async function ensureFFmpeg() {
  if (ffmpegChecked) {
    return;
  }

  try {
    await runFile(FFMPEG, ["-version"], {
      timeout: 5000,
    });

    ffmpegChecked = true;
  } catch (error) {
    const message =
      error?.code === "ENOENT"
        ? [
            "",
            "FFmpeg was not found.",
            "",
            "Install it with:",
            "",
            "  brew install ffmpeg",
            "",
            "Then restart Generative Thoughts.",
            "",
          ].join("\n")
        : `Could not run FFmpeg: ${error.message}`;

    throw new Error(message);
  }
}

async function convertToMP4(inputFile, outputFile) {
  await ensureFFmpeg();

  try {
    await runFile(
      FFMPEG,
      [
        "-y",

        "-hide_banner",

        "-loglevel",
        "error",

        "-i",
        inputFile,

        "-an",

        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",

        "-c:v",
        "libx264",

        "-preset",
        "medium",

        "-crf",
        "18",

        "-movflags",
        "+faststart",

        outputFile,
      ],
      {
        timeout: 1000 * 60 * 10,
      },
    );
  } catch (error) {
    const details = String(error?.stderr || error?.message || "").trim();

    throw new Error(
      details ? `MP4 conversion failed: ${details}` : "MP4 conversion failed",
    );
  }
}

/* =========================================================
   OPEN BROWSER
   ========================================================= */

function openBrowser(url) {
  openSystemTarget(url, {
    disabled: process.env.GT_NO_OPEN === "1",
    description: "browser",
  });
}

function openPublicationFolder(directory) {
  openSystemTarget(directory, {
    disabled: process.env.GT_NO_OPEN === "1",
    description: "published folder",
  });
}

/* =========================================================
   EXISTING SERVER
   ========================================================= */

function existingAppIsRunning() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: HOST,

        port: PORT,

        path: "/api/thoughts",

        timeout: 1000,
      },

      (response) => {
        const chunks = [];

        response.on(
          "data",

          (chunk) => chunks.push(chunk),
        );

        response.on(
          "end",

          () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

              resolve(
                response.statusCode === 200 &&
                  Array.isArray(body.thoughts) &&
                  Number.isFinite(body.nextIndex),
              );
            } catch {
              resolve(false);
            }
          },
        );
      },
    );

    request.on(
      "error",

      () => resolve(false),
    );

    request.on(
      "timeout",

      () => {
        request.destroy();

        resolve(false);
      },
    );
  });
}

/* =========================================================
   BODY
   ========================================================= */

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/* =========================================================
   SCAN THOUGHT ARCHIVE
   ========================================================= */

async function scan() {
  const names = (await fs.readdir(THOUGHTS))
    .filter((name) => /^\d+\.md$/i.test(name))
    .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));

  const result = [];

  for (const name of names) {
    try {
      const raw = await fs.readFile(
        path.join(THOUGHTS, name),

        "utf8",
      );

      const { meta, text } = parseThought(raw);

      result.push({
        id: meta.id || name.replace(/\.md$/i, ""),

        index: Number(meta.index) || Number.parseInt(name, 10),

        title: meta.title || "",

        createdAt: meta.created || null,

        updatedAt: meta.updated || null,

        typingMs: Number(meta.typing_ms) || 0,

        visualSeed: Number(meta.visual_seed) || 1,

        words: (text.trim().match(/\S+/g) || []).length,
      });
    } catch {
      /*
        Ignore malformed files.
      */
    }
  }

  return result;
}

/* =========================================================
   GET ONE THOUGHT
   ========================================================= */

async function recoverAnalysisFromPublication(thought) {
  const prefix = publicationPrefix(thought.index);
  const entries = await fs.readdir(PUBLISHED, { withFileTypes: true });
  const publicationDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const directory of publicationDirectories) {
    const publicationFile = path.join(PUBLISHED, directory, "index.md");

    try {
      const markdown = await fs.readFile(publicationFile, "utf8");
      const recovered = recoverPublishedAnalysis(markdown, thought);

      if (!recovered) continue;

      return {
        index: thought.index,
        title: thought.title,
        updatedAt: thought.updatedAt,
        sourceUpdatedAt: thought.updatedAt,
        embeddingModel: null,
        synthesisModel: AI_MODELS.synthesisModel,
        embedding: [],
        synthesis: {
          reflection: recovered.reflection,
        },
        trace: null,
        modelProvenance: null,
        nearest: [],
        recoveredFrom: path.relative(ROOT, publicationFile),
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return null;
}

async function getThought(id) {
  const entries = await scan();

  const item = entries.find(
    (entry) => entry.id === id || String(entry.index) === String(id),
  );

  if (!item) {
    return null;
  }

  const raw = await fs.readFile(
    path.join(
      THOUGHTS,

      thoughtFilename(item.index),
    ),

    "utf8",
  );

  const { meta, text } = parseThought(raw);

  const index = await readJSON(
    INDEX,

    {},
  );

  const thought = {
    ...item,

    title: meta.title || item.title,

    text,
  };

  const storedAnalysis = index[item.id] || null;

  const recoveredAnalysis = storedAnalysis
    ? null
    : await recoverAnalysisFromPublication(thought);

  return {
    ...thought,

    machineAnalysis: storedAnalysis || recoveredAnalysis,
  };
}

/* =========================================================
   COSINE SIMILARITY
   ========================================================= */

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) {
    return null;
  }

  const n = Math.min(
    a.length,

    b.length,
  );

  let dot = 0;

  let aa = 0;

  let bb = 0;

  for (let i = 0; i < n; i += 1) {
    const x = Number(a[i]) || 0;

    const y = Number(b[i]) || 0;

    dot += x * y;

    aa += x * x;

    bb += y * y;
  }

  if (!aa || !bb) {
    return null;
  }

  return dot / Math.sqrt(aa * bb);
}

/* =========================================================
   DATA URL
   ========================================================= */

function decodeJPEG(data) {
  if (typeof data !== "string") {
    throw new Error("Invalid JPEG data");
  }

  const match = data.match(/^data:image\/jpeg(?:;[^,]*)?;base64,(.+)$/s);

  if (!match) {
    throw new Error("Published image is not valid JPEG data");
  }

  return Buffer.from(
    match[1],

    "base64",
  );
}

function decodeVideo(data) {
  if (typeof data !== "string") {
    throw new Error("Invalid video data");
  }

  const match = data.match(/^data:(video\/[^;,]+)((?:;[^,]*)*);base64,(.+)$/s);

  if (!match) {
    throw new Error("Published video is not valid base64 video data");
  }

  const mime = match[1].toLowerCase();

  let extension = "webm";

  if (mime === "video/mp4") {
    extension = "mp4";
  } else if (mime === "video/quicktime") {
    extension = "mov";
  } else if (mime === "video/ogg") {
    extension = "ogv";
  }

  return {
    mime,

    extension,

    buffer: Buffer.from(
      match[3],

      "base64",
    ),
  };
}

/* =========================================================
   REMOVE OLD PUBLICATION DIRECTORY
   ========================================================= */

async function removePublicationFolders(index) {
  const prefix = publicationPrefix(index);

  const entries = await fs.readdir(
    PUBLISHED,

    {
      withFileTypes: true,
    },
  );

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(prefix)) {
      await fs.rm(
        path.join(
          PUBLISHED,

          entry.name,
        ),

        {
          recursive: true,

          force: true,
        },
      );
    }
  }
}

/* =========================================================
   SAVE STATIC IMAGES
   ========================================================= */

async function savePublicationImages(
  directory,

  images,
) {
  const saved = [];

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];

    const page = pageName(image?.page) || pageName(i + 1);

    const buffer = decodeJPEG(image?.data);

    const name = `${page}.jpg`;

    const destination = path.join(
      directory,

      name,
    );

    await fs.writeFile(
      destination,

      buffer,
    );

    saved.push({
      page: Number(page),

      name,

      path: destination,
    });
  }

  return saved;
}

/* =========================================================
   SAVE / CONVERT VIDEOS
   ========================================================= */

async function savePublicationVideos(
  directory,

  videos,
) {
  if (!Array.isArray(videos) || !videos.length) {
    return [];
  }

  await ensureFFmpeg();

  const saved = [];

  for (let i = 0; i < videos.length; i += 1) {
    const video = videos[i];

    const page = pageName(video?.page) || pageName(i + 1);

    const decoded = decodeVideo(video?.data);

    const tempName = `.video-${page}-${randomUUID()}.${decoded.extension}`;

    const tempFile = path.join(
      directory,

      tempName,
    );

    const finalName = `${page}.mp4`;

    const finalFile = path.join(
      directory,

      finalName,
    );

    try {
      await fs.writeFile(
        tempFile,

        decoded.buffer,
      );

      await convertToMP4(
        tempFile,

        finalFile,
      );

      saved.push({
        page: Number(page),

        name: finalName,

        path: finalFile,
      });
    } finally {
      await fs.rm(
        tempFile,

        {
          force: true,
        },
      );
    }
  }

  return saved;
}

/* =========================================================
   SAVE PUBLICATION

   published/
     thought-001-title/
       index.md

       01.jpg
       01.mp4

       02.jpg
       02.mp4

       03.jpg
       03.mp4

   Video files are optional.

   Static JPGs remain required.
   ========================================================= */

async function savePublication(body) {
  const id = String(body.id || "");

  const index = Number(body.index);

  const title = String(body.title || "");

  const markdown = String(body.markdown || "");

  const images = body.images;

  const videos = Array.isArray(body.videos) ? body.videos : [];

  if (!id) {
    throw new Error("Missing thought ID");
  }

  if (!Number.isInteger(index) || index < 1) {
    throw new Error("Invalid thought index");
  }

  if (!markdown.trim()) {
    throw new Error("Missing Markdown");
  }

  if (!Array.isArray(images) || !images.length) {
    throw new Error("No images supplied");
  }

  const thought = await getThought(id);

  if (!thought) {
    throw new Error("Thought does not exist in archive");
  }

  if (thought.index !== index) {
    throw new Error("Thought index does not match archive");
  }

  /*
    Validate everything before deleting
    the previous publication.
  */

  const decodedImages = images.map((image) => ({
    page: Number(image?.page),
    buffer: decodeJPEG(image?.data),
  }));

  for (const video of videos) {
    decodeVideo(video?.data);
  }

  const finalName = publicationDirectoryName(index, title);

  const finalDirectory = path.join(PUBLISHED, finalName);

  const temporaryDirectory = path.join(PUBLISHED, `.tmp-${id}-${Date.now()}`);

  await fs.mkdir(temporaryDirectory, {
    recursive: true,
  });

  try {
    /*
      Markdown
    */

    await fs.writeFile(
      path.join(temporaryDirectory, "index.md"),

      markdown,

      "utf8",
    );

    /*
      Static images
    */

    const savedImages = [];

    for (let i = 0; i < decodedImages.length; i += 1) {
      const image = decodedImages[i];

      const page =
        Number.isInteger(image.page) && image.page > 0 ? image.page : i + 1;

      const name = `${String(page).padStart(2, "0")}.jpg`;

      await fs.writeFile(
        path.join(temporaryDirectory, name),

        image.buffer,
      );

      savedImages.push(name);
    }

    /*
      Browser-recorded WebM
      -> H.264 MP4
    */

    const savedVideos = await savePublicationVideos(temporaryDirectory, videos);

    /*
      Don't delete the previous publication
      until BOTH images and MP4 conversion
      succeeded.
    */

    await removePublicationFolders(index);

    await fs.rename(temporaryDirectory, finalDirectory);

    return {
      ok: true,

      id,

      index,

      directory: finalName,

      markdown: path.relative(
        ROOT,

        path.join(finalDirectory, "index.md"),
      ),

      images: savedImages.map((name) =>
        path.relative(ROOT, path.join(finalDirectory, name)),
      ),

      videos: savedVideos.map((video) =>
        path.relative(ROOT, path.join(finalDirectory, video.name)),
      ),
    };
  } catch (error) {
    await fs.rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });

    throw error;
  }
}
/* =========================================================
   DELETE PERMANENT THOUGHT
   ========================================================= */

async function deleteThought(id) {
  const thought = await getThought(id);

  if (!thought) {
    return null;
  }

  /*
    Main markdown archive
  */

  await fs.rm(
    path.join(
      THOUGHTS,

      thoughtFilename(thought.index),
    ),

    {
      force: true,
    },
  );

  /*
    Analysis
  */

  const data = await readJSON(
    INDEX,

    {},
  );

  if (
    Object.prototype.hasOwnProperty.call(
      data,

      thought.id,
    )
  ) {
    delete data[thought.id];

    await writeJSONAtomic(
      INDEX,

      data,
    );
  }

  /*
    Published folder

    This removes JPGs and MP4s
    together.
  */

  await removePublicationFolders(thought.index);

  return {
    ok: true,

    id: thought.id,

    index: thought.index,
  };
}

/* =========================================================
   API
   ========================================================= */

async function handleAPI(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJSON(res, 200, { ok: true });
    return true;
  }

  /* ---------------------------------------------------------
     LIST THOUGHTS
     --------------------------------------------------------- */

  if (req.method === "GET" && url.pathname === "/api/thoughts") {
    const thoughts = await scan();

    const max = thoughts.reduce(
      (m, item) =>
        Math.max(
          m,

          item.index || 0,
        ),

      0,
    );

    sendJSON(
      res,

      200,

      {
        thoughts,

        nextIndex: max + 1,
      },
    );

    return true;
  }

  /* ---------------------------------------------------------
     DELETE THOUGHT
     --------------------------------------------------------- */

  if (req.method === "DELETE" && url.pathname.startsWith("/api/thoughts/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/thoughts/".length));

    const deleted = await deleteThought(id);

    if (!deleted) {
      sendJSON(
        res,

        404,

        {
          error: "NOT_FOUND",
        },
      );

      return true;
    }

    sendJSON(
      res,

      200,

      deleted,
    );

    return true;
  }

  /* ---------------------------------------------------------
     GET ONE THOUGHT
     --------------------------------------------------------- */

  if (req.method === "GET" && url.pathname.startsWith("/api/thoughts/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/thoughts/".length));

    const thought = await getThought(id);

    if (!thought) {
      sendJSON(
        res,

        404,

        {
          error: "NOT_FOUND",
        },
      );

      return true;
    }

    sendJSON(
      res,

      200,

      thought,
    );

    return true;
  }

  /* ---------------------------------------------------------
     SAVE / UPDATE PERMANENT THOUGHT
     --------------------------------------------------------- */

  if (req.method === "POST" && url.pathname === "/api/thoughts/save") {
    const body = await readBody(req);

    const entries = await scan();

    const current = body.id
      ? entries.find((entry) => entry.id === body.id)
      : null;

    if (body.id && !current) {
      sendJSON(
        res,

        409,

        {
          error: "STALE_THOUGHT",

          message: "This thought no longer exists in the archive.",
        },
      );

      return true;
    }

    const previous = current ? await getThought(current.id) : null;

    const max = entries.reduce(
      (m, item) =>
        Math.max(
          m,

          item.index || 0,
        ),

      0,
    );

    const index = current?.index || max + 1;

    const now = new Date().toISOString();

    const record = {
      id: current?.id || randomUUID(),

      index,

      title: String(body.title || ""),

      text: String(body.text || ""),

      createdAt: current?.createdAt || body.createdAt || now,

      updatedAt: now,

      typingMs: Number(body.typingMs) || 0,

      visualSeed: Number(body.visualSeed) || 1,
    };

    await writeTextAtomic(
      path.join(
        THOUGHTS,

        thoughtFilename(index),
      ),

      serializeThought(record),
    );

    const contentChanged =
      previous &&
      (previous.title !== record.title || previous.text !== record.text);

    if (contentChanged) {
      const analysisIndex = await readJSON(INDEX, {});

      if (Object.prototype.hasOwnProperty.call(analysisIndex, record.id)) {
        delete analysisIndex[record.id];
        await writeJSONAtomic(INDEX, analysisIndex);
      }
    }

    sendJSON(
      res,

      200,

      record,
    );

    return true;
  }

  /* ---------------------------------------------------------
     SAVE ANALYSIS
     --------------------------------------------------------- */

  if (req.method === "POST" && url.pathname === "/api/analysis/save") {
    const body = await readBody(req);

    if (!body.id || !Array.isArray(body.embedding)) {
      sendJSON(
        res,

        400,

        {
          error: "INVALID_ANALYSIS",
        },
      );

      return true;
    }

    const thought = await getThought(body.id);

    if (!thought) {
      sendJSON(
        res,

        404,

        {
          error: "NOT_FOUND",
        },
      );

      return true;
    }

    if (body.sourceUpdatedAt && body.sourceUpdatedAt !== thought.updatedAt) {
      sendJSON(
        res,

        409,

        {
          error: "STALE_ANALYSIS",

          message: "The writing changed before this analysis could be saved.",
        },
      );

      return true;
    }

    const data = await readJSON(
      INDEX,

      {},
    );

    const nearest = Object.entries(data)
      .filter(([id, entry]) => id !== body.id && Array.isArray(entry.embedding))

      .map(([id, entry]) => ({
        id,

        index: entry.index,

        title: entry.title,

        similarity: cosine(
          body.embedding,

          entry.embedding,
        ),
      }))

      .filter((entry) => entry.similarity != null)

      .sort((a, b) => b.similarity - a.similarity)

      .slice(0, 4);

    const record = {
      index: thought.index,

      title: thought.title,

      updatedAt: thought.updatedAt,

      sourceUpdatedAt: thought.updatedAt,

      embeddingModel: body.embeddingModel || null,

      synthesisModel: body.synthesisModel || null,

      embedding: body.embedding,

      synthesis: body.synthesis || null,

      /*
    KEEP THE LOCAL MODEL TRACE.

    Without this, the trace exists immediately
    after AI generation but disappears after
    reloading a published thought.
  */

      trace: body.trace || null,

      modelProvenance: body.modelProvenance || null,

      nearest,
    };

    data[body.id] = record;

    await writeJSONAtomic(
      INDEX,

      data,
    );

    sendJSON(
      res,

      200,

      record,
    );

    return true;
  }

  /* ---------------------------------------------------------
     PUBLISH

     Accepts:

     {
       id,
       index,
       title,
       markdown,

       images: [
         {
           page: 1,
           data: "data:image/jpeg;base64,..."
         }
       ],

       videos: [
         {
           page: 1,
           data: "data:video/webm;base64,..."
         }
       ]
     }

     Every page still gets a JPG.

     Any page supplied under videos
     additionally gets an MP4.
     --------------------------------------------------------- */

  if (req.method === "POST" && url.pathname === "/api/publish") {
    const body = await readBody(req);

    try {
      const result = await savePublication(body);

      sendJSON(
        res,

        200,

        result,
      );

      openPublicationFolder(path.join(PUBLISHED, result.directory));
    } catch (error) {
      console.error(
        "Publish failed:",

        error,
      );

      sendJSON(
        res,

        400,

        {
          error: error.message || "PUBLISH_FAILED",
        },
      );
    }

    return true;
  }

  return false;
}

/* =========================================================
   SERVER
   ========================================================= */

let vite;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url || "/",

      `http://${req.headers.host || `${HOST}:${PORT}`}`,
    );

    /*
          API has priority.
        */

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleAPI(
        req,

        res,

        url,
      );

      if (!handled) {
        sendJSON(
          res,

          404,

          {
            error: "API_NOT_FOUND",
          },
        );
      }

      return;
    }

    /*
          Everything else -> Vite.
        */

    vite.middlewares(
      req,

      res,

      () => {
        res.writeHead(404);

        res.end("Not found");
      },
    );
  } catch (error) {
    console.error(error);

    sendJSON(
      res,

      500,

      {
        error: error.message || "SERVER_ERROR",
      },
    );
  }
});

/* =========================================================
   VITE
   ========================================================= */

vite = await createViteServer({
  root: DIST,

  publicDir: PUBLIC,

  appType: "spa",

  server: {
    middlewareMode: true,

    hmr: {
      server,
    },
  },
});

/* =========================================================
   SERVER ERROR
   ========================================================= */

server.on(
  "error",

  async (error) => {
    if (error.code === "EADDRINUSE" && (await existingAppIsRunning())) {
      console.log(`Generative Thoughts is already running → ${APP_URL}`);

      openBrowser(APP_URL);

      await vite.close();

      return;
    }

    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${PORT} is already being used by another application.`
        : error,
    );

    await vite.close();

    process.exitCode = 1;
  },
);

/* =========================================================
   START
   ========================================================= */

server.listen(
  PORT,

  HOST,

  () => {
    console.log(`Generative Thoughts → ${APP_URL}`);

    console.log(`Markdown archive → ${THOUGHTS}`);

    console.log(`Published files → ${PUBLISHED}`);

    openBrowser(APP_URL);
  },
);
