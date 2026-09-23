const decodedRasters = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function hasInterludeRaster(interlude) {
  const width = Number(interlude?.raster?.width);
  const height = Number(interlude?.raster?.height);
  const data = String(interlude?.raster?.data || "");
  return width > 0 && height > 0 && data.length > 0;
}

function decodeRaster(interlude) {
  if (!hasInterludeRaster(interlude)) return null;

  const encoded = interlude.raster.data;
  let pixels = decodedRasters.get(encoded);

  if (!pixels) {
    const binary = atob(encoded);
    pixels = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    decodedRasters.set(encoded, pixels);
  }

  return {
    width: Number(interlude.raster.width),
    height: Number(interlude.raster.height),
    pixels,
  };
}

function darknessAt(raster, u, v) {
  const x = Math.min(
    raster.width - 1,
    Math.max(0, Math.floor(clamp(u, 0, 1) * (raster.width - 1))),
  );
  const y = Math.min(
    raster.height - 1,
    Math.max(0, Math.floor(clamp(v, 0, 1) * (raster.height - 1))),
  );
  return 1 - (raster.pixels[y * raster.width + x] || 0) / 255;
}

export function sampleInterludeTone(interlude, u, v) {
  const raster = decodeRaster(interlude);
  if (!raster) return 0;

  const center = darknessAt(raster, u, v);
  const dx = 1 / raster.width;
  const dy = 1 / raster.height;
  const edge = clamp(
    Math.abs(darknessAt(raster, u + dx, v) - darknessAt(raster, u - dx, v)) +
      Math.abs(darknessAt(raster, u, v + dy) - darknessAt(raster, u, v - dy)),
    0,
    1,
  );

  return clamp(center * 0.9 + edge * 0.28, 0, 1);
}
