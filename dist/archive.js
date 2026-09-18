export async function listThoughts() {
  const response = await fetch("/api/thoughts", { cache: "no-store" });
  if (!response.ok) throw new Error("Archive unavailable");
  return response.json();
}

export async function loadThought(id) {
  const response = await fetch(`/api/thoughts/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Thought unavailable");
  return response.json();
}

export async function saveThought(payload) {
  const response = await fetch("/api/thoughts/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Save failed");
  return data;
}

export async function saveAnalysis(payload) {
  const response = await fetch("/api/analysis/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Analysis save failed");
  return data;
}
