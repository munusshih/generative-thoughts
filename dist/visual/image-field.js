import { clamp } from "../helpers.js";

export function getShapeImage(state) {
  return state.shapeImage || state.visualImage || state.uploadedImage || null;
}

function sampleImageTone(image, u, v) {
  const x = Math.min(
    image.width - 1,
    Math.max(0, Math.floor(clamp(u, 0, 1) * (image.width - 1))),
  );
  const y = Math.min(
    image.height - 1,
    Math.max(0, Math.floor(clamp(v, 0, 1) * (image.height - 1))),
  );
  const pixel = image.get(x, y);

  if (!pixel || pixel.length < 3) return 0;

  const alpha = pixel.length > 3 ? pixel[3] / 255 : 1;
  const luminance =
    (pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722) / 255;

  return clamp(1 - luminance, 0, 1) * alpha;
}

export function evaluateImageField(state, x, y) {
  const image = getShapeImage(state);

  if (!image || typeof image.get !== "function" || !image.width || !image.height) {
    return null;
  }

  const u = (x + 1) * 0.5;
  const v = (y + 1) * 0.5;
  const center = sampleImageTone(image, u, v);
  const dx = 1 / image.width;
  const dy = 1 / image.height;
  const edge = clamp(
    Math.abs(sampleImageTone(image, u + dx, v) - sampleImageTone(image, u - dx, v)) +
      Math.abs(sampleImageTone(image, u, v + dy) - sampleImageTone(image, u, v - dy)),
    0,
    1,
  );

  return clamp(Math.pow(center, 1.08) * 0.86 + edge * 0.22, 0, 1);
}
