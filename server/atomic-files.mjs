import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function replaceAtomically(file, contents, encoding) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, contents, encoding);

  try {
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

export function writeJSONAtomic(file, value) {
  return replaceAtomically(file, JSON.stringify(value, null, 2), "utf8");
}

export function writeTextAtomic(file, value) {
  return replaceAtomically(file, value, "utf8");
}
