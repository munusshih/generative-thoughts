import sharp from "sharp";

import { deriveImageSearch } from "./image-keywords.mjs";

const MET_API = "https://collectionapi.metmuseum.org/public/collection";
const MET_IMAGE_HOST = "images.metmuseum.org";
const SEARCH_LIMIT = 24;
const OBJECT_LIMIT = 12;
const DOWNLOAD_LIMIT_BYTES = 12 * 1024 * 1024;
const RASTER_WIDTH = 72;
const RASTER_HEIGHT = 90;

function hashString(value) {
  let hash = 2166136261;

  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Generative-Thoughts/0.3 (local art research tool)",
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJSON(fetchFn, url) {
  const response = await fetchWithTimeout(fetchFn, url);
  if (!response.ok) throw new Error(`The Met API returned ${response.status}.`);
  return response.json();
}

function rotateSelection(values, seed, count) {
  if (!values.length) return [];
  const start = seed % values.length;
  const rotated = values.slice(start).concat(values.slice(0, start));
  return rotated.slice(0, count);
}

function objectSearchText(object) {
  return [
    object.title,
    object.objectName,
    object.artistDisplayName,
    object.culture,
    object.medium,
    ...(object.tags || []).map((tag) => tag?.term),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreObject(object, keywords, seed) {
  const haystack = objectSearchText(object);
  const matches = keywords.reduce(
    (total, keyword) => total + (haystack.includes(keyword.toLowerCase()) ? 1 : 0),
    0,
  );
  const stableVariation =
    (hashString(`${seed}:${object.objectID}`) % 1000) / 1000;

  return matches * 5 + (object.isHighlight ? 2 : 0) + stableVariation;
}

async function searchObjects(
  fetchFn,
  query,
  keywords,
  seed,
  { highlightsOnly = true } = {},
) {
  const searchURL = new URL(`${MET_API}/v1.1/search`);
  searchURL.searchParams.set("q", query);
  searchURL.searchParams.set("hasImages", "true");
  if (highlightsOnly) searchURL.searchParams.set("isHighlight", "true");
  searchURL.searchParams.set("limit", String(SEARCH_LIMIT));

  const result = await fetchJSON(fetchFn, searchURL);
  const ids = Array.isArray(result.objectIDs) ? result.objectIDs : [];
  const selectedIds = rotateSelection(
    ids,
    hashString(`${query}:${seed}`),
    OBJECT_LIMIT,
  );
  const objects = await Promise.all(
    selectedIds.map(async (id) => {
      try {
        return await fetchJSON(fetchFn, `${MET_API}/v1/objects/${id}`);
      } catch {
        return null;
      }
    }),
  );

  return objects
    .filter(
      (object) =>
        object?.isPublicDomain === true &&
        /^https:\/\//.test(object.primaryImageSmall || ""),
    )
    .sort(
      (a, b) => scoreObject(b, keywords, seed) - scoreObject(a, keywords, seed),
    );
}

function validateImageURL(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== MET_IMAGE_HOST) {
    throw new Error("The Met returned an unexpected image host.");
  }
  return url;
}

async function rasterizeImage(fetchFn, imageURL) {
  const url = validateImageURL(imageURL);
  const response = await fetchWithTimeout(fetchFn, url, {}, 12000);
  if (!response.ok) throw new Error(`Artwork image returned ${response.status}.`);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > DOWNLOAD_LIMIT_BYTES) {
    throw new Error("Artwork image is too large to process locally.");
  }

  const source = Buffer.from(await response.arrayBuffer());
  if (!source.length || source.length > DOWNLOAD_LIMIT_BYTES) {
    throw new Error("Artwork image is empty or too large.");
  }

  const { data, info } = await sharp(source)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(RASTER_WIDTH, RASTER_HEIGHT, {
      fit: "cover",
      position: "attention",
    })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    data: data.toString("base64"),
  };
}

export async function createMetImageInterlude({
  title,
  text,
  reflection,
  visualSeed,
  fetchFn = fetch,
}) {
  const search = deriveImageSearch({ title, text, reflection });
  const seed = Number(visualSeed || hashString(`${title}\n${text}`)) >>> 0;
  let lastError = null;

  for (const query of search.queries.slice(0, 4)) {
    try {
      let objects = await searchObjects(fetchFn, query, search.keywords, seed);

      if (!objects.length) {
        objects = await searchObjects(fetchFn, query, search.keywords, seed, {
          highlightsOnly: false,
        });
      }

      for (const object of objects) {
        try {
          const raster = await rasterizeImage(fetchFn, object.primaryImageSmall);

          return {
            source: "The Metropolitan Museum of Art",
            query,
            keywords: search.keywords,
            objectId: object.objectID,
            objectTitle: object.title || "Untitled",
            artist: object.artistDisplayName || object.culture || "Unknown maker",
            date: object.objectDate || null,
            culture: object.culture || null,
            objectUrl: object.objectURL || null,
            imageUrl: object.primaryImage || object.primaryImageSmall,
            publicDomain: true,
            raster,
          };
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError?.message || "No suitable public-domain Met image was found.",
  );
}

export function normalizeImageInterlude(value) {
  const raster = value?.raster;
  const width = Number(raster?.width);
  const height = Number(raster?.height);
  const data = String(raster?.data || "");
  let decodedLength = 0;

  try {
    decodedLength = Buffer.from(data, "base64").length;
  } catch {
    decodedLength = 0;
  }

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 256 ||
    height > 256 ||
    data.length < 4 ||
    data.length > 100_000 ||
    decodedLength !== width * height ||
    value?.publicDomain !== true
  ) {
    return null;
  }

  return {
    source: String(value.source || "The Metropolitan Museum of Art").slice(0, 120),
    query: String(value.query || "").slice(0, 120),
    keywords: Array.isArray(value.keywords)
      ? value.keywords.slice(0, 8).map((item) => String(item).slice(0, 60))
      : [],
    objectId: Number(value.objectId) || null,
    objectTitle: String(value.objectTitle || "Untitled").slice(0, 300),
    artist: String(value.artist || "Unknown maker").slice(0, 300),
    date: value.date ? String(value.date).slice(0, 120) : null,
    culture: value.culture ? String(value.culture).slice(0, 120) : null,
    objectUrl: value.objectUrl ? String(value.objectUrl).slice(0, 1000) : null,
    imageUrl: value.imageUrl ? String(value.imageUrl).slice(0, 1000) : null,
    publicDomain: value.publicDomain === true,
    raster: { width, height, data },
  };
}
