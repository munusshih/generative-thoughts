import { createServerUnavailableError } from "./studio/server-connection.js";

async function request(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw createServerUnavailableError(error);
  }
}

async function responseJSON(response, fallback) {
  let data = null;

  try {
    data = await response.json();
  } catch {
    if (response.ok) throw new Error(fallback);
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || fallback);
  }

  return data;
}

export async function checkServer() {
  const response = await request("/api/health", { cache: "no-store" });
  return responseJSON(response, "Local server unavailable");
}

export async function listThoughts() {
  const response = await request("/api/thoughts", { cache: "no-store" });
  return responseJSON(response, "Archive unavailable");
}

export async function loadThought(id) {
  const response = await request(`/api/thoughts/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return responseJSON(response, "Thought unavailable");
}

export async function saveThought(payload) {
  const response = await request("/api/thoughts/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return responseJSON(response, "Save failed");
}

export async function saveAnalysis(payload) {
  const response = await request("/api/analysis/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return responseJSON(response, "Analysis save failed");
}

export async function findImageInterlude(payload) {
  const response = await request("/api/image-interlude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return responseJSON(response, "Image synthesis failed");
}
