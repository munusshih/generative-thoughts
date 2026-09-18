import http from "node:http";
import { createServer as createViteServer, loadEnv } from "vite";
import publishInstagram from "./api/instagram/publish.mjs";
import instagramStatus from "./api/instagram/status.mjs";

Object.assign(process.env, loadEnv("development", process.cwd(), ""));

const host = process.env.LOCAL_HOST || "127.0.0.1";
const port = Number(process.env.LOCAL_PORT || 5173);
const vite = await createViteServer({
  root: "dist",
  appType: "spa",
  server: { middlewareMode: true },
});

function addResponseHelpers(response) {
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (value) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(value));
    return response;
  };
  return response;
}

async function readJSON(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 30_000_000) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, rawResponse) => {
  const response = addResponseHelpers(rawResponse);
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  const handler = pathname === "/api/instagram/status"
    ? instagramStatus
    : pathname === "/api/instagram/publish"
      ? publishInstagram
      : null;

  if (!handler) {
    vite.middlewares(request, response, (error) => {
      if (error && !response.headersSent) response.status(500).end("LOCAL_SERVER_ERROR");
    });
    return;
  }

  try {
    if (request.method === "POST") request.body = await readJSON(request);
    await handler(request, response);
  } catch (error) {
    if (!response.headersSent) response.status(400).json({ error: String(error?.message || "BAD_REQUEST") });
  }
});

server.listen(port, host, () => {
  console.log(`Generative Thoughts: http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`);
});

async function close() {
  await vite.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
