import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const DIST = path.join(ROOT, "dist");
const THOUGHTS = path.join(ROOT, "thoughts");
const DATA = path.join(ROOT, "data");
const INDEX = path.join(DATA, "index.json");

const HOST = "127.0.0.1";
const PORT = 9999;

await fs.mkdir(THOUGHTS, { recursive: true });
await fs.mkdir(DATA, { recursive: true });

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJSONAtomic(file, value) {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, file);
}

function sendJSON(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function filename(index) {
  return `${String(index).padStart(3, "0")}.md`;
}

function serialize(record) {
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

function parse(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, text: markdown };

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
    text: markdown.slice(match[0].length).replace(/\n$/, ""),
  };
}

async function scan() {
  const names = (await fs.readdir(THOUGHTS))
    .filter((name) => /^\d+\.md$/i.test(name))
    .sort((a, b) => Number.parseInt(b) - Number.parseInt(a));

  const result = [];

  for (const name of names) {
    try {
      const raw = await fs.readFile(path.join(THOUGHTS, name), "utf8");
      const { meta, text } = parse(raw);
      result.push({
        id: meta.id || name.replace(/\.md$/i, ""),
        index: Number(meta.index) || Number.parseInt(name),
        title: meta.title || "",
        createdAt: meta.created || null,
        updatedAt: meta.updated || null,
        typingMs: Number(meta.typing_ms) || 0,
        visualSeed: Number(meta.visual_seed) || 1,
        words: (text.trim().match(/\S+/g) || []).length,
      });
    } catch {}
  }

  return result;
}

async function getThought(id) {
  const entries = await scan();
  const item = entries.find(
    (entry) => entry.id === id || String(entry.index) === String(id)
  );
  if (!item) return null;

  const raw = await fs.readFile(
    path.join(THOUGHTS, filename(item.index)),
    "utf8"
  );
  const { meta, text } = parse(raw);
  const index = await readJSON(INDEX, {});

  return {
    ...item,
    title: meta.title || item.title,
    text,
    machineAnalysis: index[item.id] || null,
  };
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) {
    return null;
  }

  const n = Math.min(a.length, b.length);
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

  if (!aa || !bb) return null;
  return dot / Math.sqrt(aa * bb);
}

async function handleAPI(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/thoughts") {
    const thoughts = await scan();
    const max = thoughts.reduce((m, item) => Math.max(m, item.index || 0), 0);
    sendJSON(res, 200, { thoughts, nextIndex: max + 1 });
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/thoughts/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/thoughts/".length));
    const thought = await getThought(id);
    if (!thought) {
      sendJSON(res, 404, { error: "NOT_FOUND" });
      return true;
    }
    sendJSON(res, 200, thought);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/thoughts/save") {
    const body = await readBody(req);
    const entries = await scan();
    const current = body.id
      ? entries.find((entry) => entry.id === body.id)
      : null;

    const max = entries.reduce((m, item) => Math.max(m, item.index || 0), 0);
    const index = current?.index || Number(body.index) || max + 1;
    const now = new Date().toISOString();

    const record = {
      id: current?.id || body.id || crypto.randomUUID(),
      index,
      title: String(body.title || ""),
      text: String(body.text || ""),
      createdAt: current?.createdAt || body.createdAt || now,
      updatedAt: now,
      typingMs: Number(body.typingMs) || 0,
      visualSeed: Number(body.visualSeed) || 1,
    };

    await fs.writeFile(
      path.join(THOUGHTS, filename(index)),
      serialize(record),
      "utf8"
    );

    sendJSON(res, 200, record);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/analysis/save") {
    const body = await readBody(req);
    if (!body.id || !Array.isArray(body.embedding)) {
      sendJSON(res, 400, { error: "INVALID_ANALYSIS" });
      return true;
    }

    const thought = await getThought(body.id);
    if (!thought) {
      sendJSON(res, 404, { error: "NOT_FOUND" });
      return true;
    }

    const data = await readJSON(INDEX, {});
    const nearest = Object.entries(data)
      .filter(([id, entry]) => id !== body.id && Array.isArray(entry.embedding))
      .map(([id, entry]) => ({
        id,
        index: entry.index,
        title: entry.title,
        similarity: cosine(body.embedding, entry.embedding),
      }))
      .filter((entry) => entry.similarity != null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 4);

    const record = {
      index: thought.index,
      title: thought.title,
      updatedAt: thought.updatedAt,
      embeddingModel: body.embeddingModel || null,
      synthesisModel: body.synthesisModel || null,
      embedding: body.embedding,
      synthesis: body.synthesis || null,
      nearest,
    };

    data[body.id] = record;
    await writeJSONAtomic(INDEX, data);

    sendJSON(res, 200, record);
    return true;
  }

  return false;
}

let vite;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleAPI(req, res, url);
      if (!handled) sendJSON(res, 404, { error: "API_NOT_FOUND" });
      return;
    }

    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end("Not found");
    });
  } catch (error) {
    console.error(error);
    sendJSON(res, 500, { error: error.message });
  }
});

vite = await createViteServer({
  root: DIST,
  appType: "spa",
  server: {
    middlewareMode: true,
    hmr: { server },
  },
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Generative Thoughts → ${url}`);
  console.log(`Markdown archive → ${THOUGHTS}`);

  if (process.env.GT_NO_OPEN !== "1" && process.platform === "darwin") {
    execFile("open", [url], () => {});
  }
});
