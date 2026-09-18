import crypto from "node:crypto";
import { del, put } from "@vercel/blob";

const GRAPH_HOST = process.env.META_GRAPH_HOST || "https://graph.instagram.com";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v24.0";

export const config = { maxDuration: 60 };

export default async function handler(request, response) {
  setCors(request, response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (!serverConfigured()) return response.status(503).json({ error: "INSTAGRAM_SERVER_NOT_CONFIGURED" });
  if (!secretMatches(request.headers["x-publish-secret"] || "")) return response.status(401).json({ error: "PUBLISH_SECRET_MISMATCH" });

  const { slides, caption = "", index = 0, title = "untitled" } = request.body || {};
  if (!Array.isArray(slides) || slides.length < 2 || slides.length > 10) {
    return response.status(400).json({ error: "CAROUSEL_REQUIRES_2_TO_10_SLIDES" });
  }
  if (caption.length > 2200) return response.status(400).json({ error: "CAPTION_TOO_LONG" });

  const uploadedMedia = [];
  try {
    for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
      const slide = typeof slides[slideIndex] === "string"
        ? { type: "image", dataUrl: slides[slideIndex] }
        : slides[slideIndex];
      const type = slide?.type === "video" ? "video" : "image";
      const mime = type === "video" ? "video/mp4" : "image/jpeg";
      const extension = type === "video" ? "mp4" : "jpg";
      const match = new RegExp(`^data:${mime.replace("/", "\\/")};base64,([A-Za-z0-9+/=]+)$`).exec(slide?.dataUrl || "");
      if (!match) throw new Error(`SLIDE_${slideIndex + 1}_IS_NOT_${type.toUpperCase()}`);
      const media = Buffer.from(match[1], "base64");
      const maximumBytes = type === "video" ? 20_000_000 : 8_000_000;
      if (media.byteLength > maximumBytes) throw new Error(`SLIDE_${slideIndex + 1}_TOO_LARGE`);
      const blob = await put(
        `instagram/gt-${String(index).padStart(3, "0")}-${slideIndex + 1}.${extension}`,
        media,
        { access: "public", addRandomSuffix: true, contentType: mime }
      );
      uploadedMedia.push({ type, url: blob.url });
    }

    const childIds = [];
    for (const media of uploadedMedia) {
      const values = media.type === "video"
        ? { media_type: "VIDEO", video_url: media.url, is_carousel_item: "true" }
        : { image_url: media.url, is_carousel_item: "true" };
      const child = await graphPost(`/${process.env.INSTAGRAM_USER_ID}/media`, values);
      await waitUntilReady(child.id);
      childIds.push(child.id);
    }

    const carousel = await graphPost(`/${process.env.INSTAGRAM_USER_ID}/media`, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: caption || `${title} — Generative Thoughts ${String(index).padStart(3, "0")}`,
    });
    await waitUntilReady(carousel.id);
    const published = await graphPost(`/${process.env.INSTAGRAM_USER_ID}/media_publish`, {
      creation_id: carousel.id,
    });

    return response.status(200).json({ ok: true, mediaId: published.id });
  } catch (error) {
    console.error("Instagram publish failed", error);
    return response.status(502).json({ error: safeError(error) });
  } finally {
    const uploadedUrls = uploadedMedia.map((media) => media.url);
    if (uploadedUrls.length) await del(uploadedUrls).catch((error) => console.error("Temporary blob cleanup failed", error));
  }
}
function serverConfigured() {
  return Boolean(
    process.env.INSTAGRAM_USER_ID
      && process.env.INSTAGRAM_ACCESS_TOKEN
      && process.env.PUBLISH_SECRET
      && process.env.BLOB_READ_WRITE_TOKEN
  );
}

function secretMatches(candidate) {
  const expected = Buffer.from(process.env.PUBLISH_SECRET || "");
  const received = Buffer.from(candidate);
  return expected.length === received.length && expected.length > 0 && crypto.timingSafeEqual(expected, received);
}

async function graphPost(path, values) {
  const body = new URLSearchParams({ ...values, access_token: process.env.INSTAGRAM_ACCESS_TOKEN });
  const response = await fetch(`${GRAPH_HOST}/${GRAPH_VERSION}${path}`, { method: "POST", body });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message || `META_HTTP_${response.status}`);
  return result;
}

async function waitUntilReady(containerId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const query = new URLSearchParams({ fields: "status_code,status", access_token: process.env.INSTAGRAM_ACCESS_TOKEN });
    const response = await fetch(`${GRAPH_HOST}/${GRAPH_VERSION}/${containerId}?${query}`);
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error?.message || `META_STATUS_HTTP_${response.status}`);
    if (result.status_code === "FINISHED" || result.status_code === "PUBLISHED") return;
    if (result.status_code === "ERROR" || result.status_code === "EXPIRED") throw new Error(result.status || result.status_code);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("META_CONTAINER_TIMEOUT");
}

function safeError(error) {
  return String(error?.message || "INSTAGRAM_PUBLISH_FAILED").slice(0, 300);
}

function setCors(request, response) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  const requestOrigin = request.headers.origin;
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Publish-Secret");
  response.setHeader("Cache-Control", "no-store");
}
