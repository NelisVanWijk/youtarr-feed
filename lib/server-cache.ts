import { readFile } from "node:fs/promises";
import { appDataPath, writeJsonAtomic } from "./app-data";
import type { Channel, FeedVideo } from "./types";

export type VideoListPayload = {
  channels: Channel[];
  videos: FeedVideo[];
  warnings: string[];
};

export type CacheStatus = "miss" | "hit" | "stale" | "refresh";

type CacheKey = "feed" | "local-videos" | "floatplane-feed";

type CacheEnvelope<T> = {
  version: 1;
  savedAt: number;
  data: T;
};

const cacheTtlMs =
  Math.max(15, Number(process.env.YOUTARR_FEED_CACHE_TTL_SECONDS) || 300) * 1000;

const cacheFiles: Record<CacheKey, string> = {
  feed: appDataPath("feed-cache.json"),
  "local-videos": appDataPath("local-videos-cache.json"),
  "floatplane-feed": appDataPath("floatplane-feed-cache.json"),
};

const memoryCache: Partial<Record<CacheKey, CacheEnvelope<VideoListPayload>>> = {};
const refreshes: Partial<Record<CacheKey, Promise<CacheEnvelope<VideoListPayload>>>> =
  {};
const cacheGenerations: Record<CacheKey, number> = {
  feed: 0,
  "local-videos": 0,
  "floatplane-feed": 0,
};

function isCacheEnvelope(value: unknown): value is CacheEnvelope<VideoListPayload> {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<CacheEnvelope<VideoListPayload>>;
  return (
    envelope.version === 1 &&
    typeof envelope.savedAt === "number" &&
    Array.isArray(envelope.data?.channels) &&
    Array.isArray(envelope.data?.videos) &&
    Array.isArray(envelope.data?.warnings)
  );
}

async function readCache(key: CacheKey) {
  if (memoryCache[key]) return memoryCache[key];
  try {
    const parsed = JSON.parse(await readFile(cacheFiles[key], "utf8")) as unknown;
    if (!isCacheEnvelope(parsed)) return undefined;
    memoryCache[key] = parsed;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

async function refreshCache(
  key: CacheKey,
  loader: () => Promise<VideoListPayload>
) {
  if (!refreshes[key]) {
    const refreshGeneration = cacheGenerations[key];
    const refreshPromise = loader()
      .then(async (data) => {
        const envelope: CacheEnvelope<VideoListPayload> = {
          version: 1,
          savedAt: Date.now(),
          data,
        };
        if (refreshGeneration !== cacheGenerations[key]) {
          return envelope;
        }
        memoryCache[key] = envelope;
        await writeJsonAtomic(cacheFiles[key], envelope);
        return envelope;
      })
      .finally(() => {
        if (refreshes[key] === refreshPromise) {
          delete refreshes[key];
        }
      });
    refreshes[key] = refreshPromise;
  }
  return refreshes[key];
}

export async function getCachedVideoList(
  key: CacheKey,
  loader: () => Promise<VideoListPayload>,
  options: { refresh?: boolean } = {}
): Promise<{ data: VideoListPayload; cache: CacheStatus; cachedAt?: number }> {
  const cached = await readCache(key);
  if (!options.refresh && cached) {
    const fresh = Date.now() - cached.savedAt < cacheTtlMs;
    if (fresh) {
      return { data: cached.data, cache: "hit", cachedAt: cached.savedAt };
    }
    void refreshCache(key, loader).catch(() => undefined);
    return { data: cached.data, cache: "stale", cachedAt: cached.savedAt };
  }

  try {
    const refreshed = await refreshCache(key, loader);
    return {
      data: refreshed.data,
      cache: cached ? "refresh" : "miss",
      cachedAt: refreshed.savedAt,
    };
  } catch (error) {
    if (cached) {
      return { data: cached.data, cache: "stale", cachedAt: cached.savedAt };
    }
    throw error;
  }
}

export async function invalidateVideoListCache(...keys: CacheKey[]) {
  await Promise.all(
    keys.map(async (key) => {
      cacheGenerations[key] += 1;
      delete refreshes[key];
      const cached = await readCache(key);
      if (!cached) {
        delete memoryCache[key];
        return;
      }
      const staleCache = { ...cached, savedAt: 0 };
      memoryCache[key] = staleCache;
      await writeJsonAtomic(cacheFiles[key], staleCache);
    })
  );
}
