import { readFile } from "node:fs/promises";
import { appDataPath, ensureDataDirectory, writeJsonAtomic } from "./app-data";
import type { WatchProgressEntry, WatchProgressMap } from "./types";

const storePath = appDataPath("watch-progress.json");

let writeQueue = Promise.resolve();

function isValidVideoId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function normalizeEntry(entry: Partial<WatchProgressEntry>): WatchProgressEntry | null {
  const videoId = entry.videoId?.trim() || "";
  const currentTime = Number(entry.currentTime);
  const duration = Number(entry.duration);
  if (!isValidVideoId(videoId) || !Number.isFinite(currentTime) || !Number.isFinite(duration)) {
    return null;
  }
  if (duration <= 0 || currentTime < 0) return null;
  return {
    videoId,
    currentTime: Math.min(currentTime, duration),
    duration,
    updatedAt: Number(entry.updatedAt) || Date.now(),
  };
}

export async function readWatchProgress(): Promise<WatchProgressMap> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as WatchProgressMap;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([videoId, entry]) => normalizeEntry({ ...entry, videoId }))
        .filter((entry): entry is WatchProgressEntry => entry !== null)
        .map((entry) => [entry.videoId, entry])
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeWatchProgress(progress: WatchProgressMap) {
  await ensureDataDirectory();
  await writeJsonAtomic(storePath, progress);
}

export function updateWatchProgress(
  entry: Partial<WatchProgressEntry>
): Promise<WatchProgressMap> {
  const normalized = normalizeEntry({ ...entry, updatedAt: Date.now() });
  if (!normalized) {
    return Promise.reject(new Error("Ongeldige kijkvoortgang"));
  }

  writeQueue = writeQueue.then(async () => {
    const progress = await readWatchProgress();
    if (
      normalized.currentTime < 5 ||
      normalized.currentTime > normalized.duration - 8
    ) {
      delete progress[normalized.videoId];
    } else {
      progress[normalized.videoId] = normalized;
    }
    await writeWatchProgress(progress);
    return progress;
  });

  return writeQueue;
}

export function clearWatchProgress(videoId: string): Promise<WatchProgressMap> {
  if (!isValidVideoId(videoId)) {
    return Promise.reject(new Error("Ongeldig video-ID"));
  }

  writeQueue = writeQueue.then(async () => {
    const progress = await readWatchProgress();
    delete progress[videoId];
    await writeWatchProgress(progress);
    return progress;
  });

  return writeQueue;
}
