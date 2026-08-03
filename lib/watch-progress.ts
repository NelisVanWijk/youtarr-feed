import { readFile } from "node:fs/promises";
import { appDataPath, ensureDataDirectory, writeJsonAtomic } from "./app-data";
import type { WatchProgressEntry, WatchProgressMap } from "./types";

const storePath = appDataPath("watch-progress.json");
const watchedStorePath = appDataPath("watched-videos.json");
const unwatchedStorePath = appDataPath("unwatched-videos.json");

type WatchStateResult = {
  progress: WatchProgressMap;
  watchedVideoIds: string[];
  unwatchedVideoIds: string[];
};

let writeQueue: Promise<WatchStateResult | void> = Promise.resolve();

function isValidVideoId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value) || /^floatplane:[A-Za-z0-9_-]+$/.test(value);
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

export async function readWatchedVideoIds(): Promise<string[]> {
  return readVideoIdList(watchedStorePath);
}

export async function readUnwatchedVideoIds(): Promise<string[]> {
  return readVideoIdList(unwatchedStorePath);
}

async function readVideoIdList(filePath: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => isValidVideoId(id)))];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeWatchProgress(progress: WatchProgressMap) {
  await ensureDataDirectory();
  await writeJsonAtomic(storePath, progress);
}

async function writeWatchedVideoIds(videoIds: string[]) {
  await writeVideoIdList(watchedStorePath, videoIds);
}

async function writeUnwatchedVideoIds(videoIds: string[]) {
  await writeVideoIdList(unwatchedStorePath, videoIds);
}

async function writeVideoIdList(filePath: string, videoIds: string[]) {
  await ensureDataDirectory();
  await writeJsonAtomic(filePath, [
    ...new Set(videoIds.filter((id) => isValidVideoId(id))),
  ]);
}

export function updateWatchProgress(
  entry: Partial<WatchProgressEntry>
): Promise<WatchStateResult> {
  const normalized = normalizeEntry({ ...entry, updatedAt: Date.now() });
  if (!normalized) {
    return Promise.reject(new Error("Invalid watch progress"));
  }

  const result = writeQueue.then(async () => {
    const progress = await readWatchProgress();
    const watchedVideoIds = new Set(await readWatchedVideoIds());
    const unwatchedVideoIds = new Set(await readUnwatchedVideoIds());
    if (
      normalized.currentTime < 5 ||
      normalized.currentTime > normalized.duration - 8
    ) {
      delete progress[normalized.videoId];
      if (normalized.currentTime > normalized.duration - 8) {
        watchedVideoIds.add(normalized.videoId);
        unwatchedVideoIds.delete(normalized.videoId);
      }
    } else {
      progress[normalized.videoId] = normalized;
    }
    await writeWatchProgress(progress);
    await writeWatchedVideoIds([...watchedVideoIds]);
    await writeUnwatchedVideoIds([...unwatchedVideoIds]);
    return {
      progress,
      watchedVideoIds: [...watchedVideoIds],
      unwatchedVideoIds: [...unwatchedVideoIds],
    };
  });

  writeQueue = result;
  return result;
}

export function clearWatchProgress(videoId: string): Promise<WatchStateResult> {
  if (!isValidVideoId(videoId)) {
    return Promise.reject(new Error("Invalid video ID"));
  }

  const result = writeQueue.then(async () => {
    const progress = await readWatchProgress();
    const watchedVideoIds = new Set(await readWatchedVideoIds());
    const unwatchedVideoIds = new Set(await readUnwatchedVideoIds());
    delete progress[videoId];
    watchedVideoIds.delete(videoId);
    unwatchedVideoIds.delete(videoId);
    await writeWatchProgress(progress);
    await writeWatchedVideoIds([...watchedVideoIds]);
    await writeUnwatchedVideoIds([...unwatchedVideoIds]);
    return {
      progress,
      watchedVideoIds: [...watchedVideoIds],
      unwatchedVideoIds: [...unwatchedVideoIds],
    };
  });

  writeQueue = result;
  return result;
}

export function replaceWatchProgress(
  progress: WatchProgressMap,
  watchedVideoIds: string[] = [],
  unwatchedVideoIds: string[] = []
): Promise<WatchStateResult> {
  const result = writeQueue.then(async () => {
    const normalized = Object.fromEntries(
      Object.entries(progress)
        .map(([videoId, entry]) => normalizeEntry({ ...entry, videoId }))
        .filter((entry): entry is WatchProgressEntry => entry !== null)
        .map((entry) => [entry.videoId, entry])
    );
    const watchedSet = new Set(watchedVideoIds.filter((id) => isValidVideoId(id)));
    const unwatchedSet = new Set(
      unwatchedVideoIds.filter((id) => isValidVideoId(id))
    );
    for (const videoId of watchedSet) {
      delete normalized[videoId];
      unwatchedSet.delete(videoId);
    }
    await writeWatchProgress(normalized);
    await writeWatchedVideoIds([...watchedSet]);
    await writeUnwatchedVideoIds([...unwatchedSet]);
    return {
      progress: normalized,
      watchedVideoIds: [...watchedSet],
      unwatchedVideoIds: [...unwatchedSet],
    };
  });

  writeQueue = result;
  return result;
}

export function setVideoWatchedState(
  videoId: string,
  watched: boolean
): Promise<WatchStateResult> {
  if (!isValidVideoId(videoId)) {
    return Promise.reject(new Error("Invalid video ID"));
  }

  const result = writeQueue.then(async () => {
    const progress = await readWatchProgress();
    const watchedVideoIds = new Set(await readWatchedVideoIds());
    const unwatchedVideoIds = new Set(await readUnwatchedVideoIds());
    delete progress[videoId];
    if (watched) {
      watchedVideoIds.add(videoId);
      unwatchedVideoIds.delete(videoId);
    } else {
      watchedVideoIds.delete(videoId);
      unwatchedVideoIds.add(videoId);
    }
    await writeWatchProgress(progress);
    await writeWatchedVideoIds([...watchedVideoIds]);
    await writeUnwatchedVideoIds([...unwatchedVideoIds]);
    return {
      progress,
      watchedVideoIds: [...watchedVideoIds],
      unwatchedVideoIds: [...unwatchedVideoIds],
    };
  });

  writeQueue = result;
  return result;
}
