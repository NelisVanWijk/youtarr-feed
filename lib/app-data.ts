import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const dataDirectory =
  process.env.YOUTARR_FEED_DATA_DIR ||
  process.env.DATA_DIR ||
  (process.env.NODE_ENV === "production" ? "/data" : ".data");

export function appDataPath(filename: string) {
  return path.join(dataDirectory, filename);
}

export async function ensureDataDirectory() {
  await mkdir(dataDirectory, { recursive: true });
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await ensureDataDirectory();
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function removeAppDataFile(filePath: string) {
  await rm(filePath, { force: true });
}
