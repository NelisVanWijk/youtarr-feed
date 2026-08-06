import { getFloatplaneFeed, isFloatplaneConfigured } from "./floatplane";
import { getCachedVideoList } from "./server-cache";
import {
  clearAllYoutarrVideoLocationCache,
  getDownloadedVideos,
  getFeed,
  isYoutarrConfigured,
} from "./youtarr";

type FeedCacheWarmerState = {
  started: boolean;
  running: boolean;
  timer?: ReturnType<typeof setInterval>;
  startupTimer?: ReturnType<typeof setTimeout>;
};

declare global {
  var __youtarrFeedCacheWarmer: FeedCacheWarmerState | undefined;
}

const backgroundRefreshEnabled =
  (process.env.YOUTARR_FEED_BACKGROUND_REFRESH_ENABLED?.trim().toLowerCase() ||
    "true") !== "false";
const backgroundRefreshIntervalMs =
  Math.max(
    300,
    Number(process.env.YOUTARR_FEED_BACKGROUND_REFRESH_SECONDS) || 3600
  ) * 1000;
const backgroundRefreshStartDelayMs =
  Math.max(
    0,
    Number(process.env.YOUTARR_FEED_BACKGROUND_REFRESH_START_DELAY_SECONDS) || 30
  ) * 1000;

function unrefTimer(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>) {
  (timer as { unref?: () => void }).unref?.();
}

async function refreshYoutarrCaches() {
  if (!isYoutarrConfigured()) return;
  clearAllYoutarrVideoLocationCache();
  await Promise.allSettled([
    getCachedVideoList("feed", getFeed, { refresh: true }),
    getCachedVideoList("local-videos", getDownloadedVideos, { refresh: true }),
  ]);
}

async function refreshFloatplaneCache() {
  if (!(await isFloatplaneConfigured())) return;
  await getCachedVideoList("floatplane-feed", getFloatplaneFeed, {
    refresh: true,
  });
}

export async function refreshFeedCachesInBackground() {
  const state =
    globalThis.__youtarrFeedCacheWarmer ||
    (globalThis.__youtarrFeedCacheWarmer = { started: false, running: false });
  if (state.running) return;
  state.running = true;
  try {
    await Promise.allSettled([refreshYoutarrCaches(), refreshFloatplaneCache()]);
  } finally {
    state.running = false;
  }
}

export function ensureFeedCacheWarmer() {
  if (!backgroundRefreshEnabled || typeof setInterval === "undefined") return;
  const state =
    globalThis.__youtarrFeedCacheWarmer ||
    (globalThis.__youtarrFeedCacheWarmer = { started: false, running: false });
  if (state.started) return;
  state.started = true;

  state.startupTimer = setTimeout(() => {
    void refreshFeedCachesInBackground();
  }, backgroundRefreshStartDelayMs);
  unrefTimer(state.startupTimer);

  state.timer = setInterval(() => {
    void refreshFeedCachesInBackground();
  }, backgroundRefreshIntervalMs);
  unrefTimer(state.timer);
}
