import { readFile } from "node:fs/promises";
import { appDataPath, ensureDataDirectory, writeJsonAtomic } from "./app-data";
import { getLocalMediaStatus } from "./local-media";
import type { FeedVideo } from "./types";

type StoredSingleVideo = {
  id: string;
  title: string;
  thumbnail: string;
  channelName: string;
  channelAvatar: string;
  publishedAt: string | null;
  duration: number;
  downloaded: boolean;
  addedAt: number;
};

type YouTubeApiVideo = {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: {
    duration?: string;
  };
};

const storePath = appDataPath("single-videos.json");
const configuredYouTubeApiKey = process.env.YOUTUBE_API_KEY?.trim() || "";
const singleChannelPrefix = "single:";

let writeQueue = Promise.resolve();

function isValidVideoId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function singleChannelId(videoId: string) {
  return `${singleChannelPrefix}${videoId}`;
}

function fallbackVideo(videoId: string): StoredSingleVideo {
  return {
    id: videoId,
    title: `Single video ${videoId}`,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    channelName: "Single video",
    channelAvatar: "",
    publishedAt: null,
    duration: 0,
    downloaded: false,
    addedAt: Date.now(),
  };
}

function parseIsoDuration(value: string | undefined) {
  if (!value) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return 0;
  return (
    (Number(match[1]) || 0) * 3600 +
    (Number(match[2]) || 0) * 60 +
    (Number(match[3]) || 0)
  );
}

function bestThumbnail(thumbnails?: Record<string, { url?: string }>) {
  if (!thumbnails) return "";
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ""
  );
}

function normalizeStoredVideo(value: Partial<StoredSingleVideo>) {
  const id = value.id?.trim() || "";
  if (!isValidVideoId(id)) return null;
  const fallback = fallbackVideo(id);
  return {
    ...fallback,
    ...value,
    id,
    title: value.title?.trim() || fallback.title,
    thumbnail: value.thumbnail?.trim() || fallback.thumbnail,
    channelName: value.channelName?.trim() || fallback.channelName,
    channelAvatar: value.channelAvatar?.trim() || "",
    publishedAt: value.publishedAt || null,
    duration: Number(value.duration) || 0,
    downloaded: value.downloaded === true,
    addedAt: Number(value.addedAt) || Date.now(),
  };
}

export function extractYouTubeVideoId(input: string) {
  const trimmed = input.trim();
  if (isValidVideoId(trimmed)) return trimmed;

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"].includes(host)) {
      return null;
    }

    const watchId = url.searchParams.get("v");
    if (watchId && isValidVideoId(watchId)) return watchId;

    const [firstSegment, secondSegment] = url.pathname
      .split("/")
      .filter(Boolean);
    const pathId = host === "youtu.be" ? firstSegment : secondSegment;
    if (
      ["shorts", "embed", "live"].includes(firstSegment || "") &&
      pathId &&
      isValidVideoId(pathId)
    ) {
      return pathId;
    }
    if (host === "youtu.be" && pathId && isValidVideoId(pathId)) return pathId;
  } catch {
    return null;
  }

  return null;
}

async function readStoredSingleVideos() {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeStoredVideo(item as Partial<StoredSingleVideo>))
      .filter((item): item is StoredSingleVideo => item !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeStoredSingleVideos(videos: StoredSingleVideo[]) {
  await ensureDataDirectory();
  await writeJsonAtomic(storePath, videos);
}

async function fetchYouTubeMetadata(videoId: string): Promise<StoredSingleVideo> {
  const fallback = fallbackVideo(videoId);
  if (!configuredYouTubeApiKey) return fallback;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", configuredYouTubeApiKey);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return fallback;
    const data = (await response.json()) as { items?: YouTubeApiVideo[] };
    const item = data.items?.[0];
    if (!item?.id) return fallback;

    return {
      ...fallback,
      title: item.snippet?.title || fallback.title,
      thumbnail: bestThumbnail(item.snippet?.thumbnails) || fallback.thumbnail,
      channelName: item.snippet?.channelTitle || fallback.channelName,
      publishedAt: item.snippet?.publishedAt || null,
      duration: parseIsoDuration(item.contentDetails?.duration),
    };
  } catch {
    return fallback;
  }
}

export async function readSingleVideos(): Promise<FeedVideo[]> {
  const stored = await readStoredSingleVideos();
  const videos = await Promise.all(
    stored.map(async (video) => {
      const local = await getLocalMediaStatus(video.id);
      return {
        id: video.id,
        channelId: singleChannelId(video.id),
        channelName: video.channelName,
        channelAvatar: video.channelAvatar,
        title: video.title,
        thumbnail: video.thumbnail,
        publishedAt: video.publishedAt,
        duration: video.duration,
        downloaded: video.downloaded || local.available,
        missing: false,
        watched: false,
      };
    })
  );
  return videos.sort((left, right) => {
    const leftAdded = stored.find((video) => video.id === left.id)?.addedAt || 0;
    const rightAdded = stored.find((video) => video.id === right.id)?.addedAt || 0;
    return rightAdded - leftAdded;
  });
}

export function addSingleVideo(input: string): Promise<FeedVideo> {
  const videoId = extractYouTubeVideoId(input);
  if (!videoId) {
    return Promise.reject(new Error("No valid YouTube video found"));
  }

  writeQueue = writeQueue.then(async () => {
    const current = await readStoredSingleVideos();
    const existing = current.find((video) => video.id === videoId);
    const metadata = existing || (await fetchYouTubeMetadata(videoId));
    const nextVideo = {
      ...metadata,
      addedAt: Date.now(),
    };
    const next = [
      nextVideo,
      ...current.filter((video) => video.id !== videoId),
    ].slice(0, 200);
    await writeStoredSingleVideos(next);
    return (await readSingleVideos()).find((video) => video.id === videoId) as FeedVideo;
  });

  return writeQueue;
}

export function removeSingleVideo(videoId: string): Promise<FeedVideo[]> {
  if (!isValidVideoId(videoId)) {
    return Promise.reject(new Error("Invalid video ID"));
  }

  writeQueue = writeQueue.then(async () => {
    const current = await readStoredSingleVideos();
    const next = current.filter((video) => video.id !== videoId);
    await writeStoredSingleVideos(next);
    return readSingleVideos();
  });

  return writeQueue;
}
