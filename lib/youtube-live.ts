import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { appDataPath, writeJsonAtomic } from "./app-data";
import { extractYouTubeVideoId } from "./single-videos";
import type { FeedVideo } from "./types";

type StoredLiveStream = {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  channelAvatar: string;
  thumbnail: string;
  description: string;
  webpageUrl: string;
  addedAt: number;
};

type YtDlpFormat = {
  url?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  tbr?: number;
  format_note?: string;
  format_id?: string;
  ext?: string;
};

type YtDlpInfo = {
  id?: string;
  title?: string;
  channel?: string;
  channel_id?: string;
  uploader?: string;
  uploader_id?: string;
  thumbnail?: string;
  description?: string;
  webpage_url?: string;
  is_live?: boolean;
  live_status?: string;
  formats?: YtDlpFormat[];
};

export type YouTubeLivePlayback = {
  url: string;
  label: string;
  codec: string;
  height: number | null;
  mimeType: string;
  playbackMode: "hls";
};

const storePath = appDataPath("live-streams.json");
const ytDlpPath = process.env.YOUTARR_FEED_YT_DLP_PATH?.trim() || "yt-dlp";
const sourceCacheTtlMs =
  Math.max(
    30,
    Number(process.env.YOUTARR_FEED_LIVE_SOURCE_CACHE_SECONDS) || 300
  ) * 1000;
const commandTimeoutMs =
  Math.max(
    10,
    Number(process.env.YOUTARR_FEED_LIVE_RESOLVE_TIMEOUT_SECONDS) || 35
  ) * 1000;
const sourceCache = new Map<
  string,
  { expiresAt: number; playback: YouTubeLivePlayback }
>();
let writeQueue: Promise<unknown> = Promise.resolve();

function isValidVideoId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function normalizeStoredStream(value: Partial<StoredLiveStream>) {
  const id = value.id?.trim() || "";
  if (!isValidVideoId(id)) return null;
  return {
    id,
    title: value.title?.trim() || `YouTube Live ${id}`,
    channelId: value.channelId?.trim() || `live:${id}`,
    channelName: value.channelName?.trim() || "YouTube Live",
    channelAvatar: value.channelAvatar?.trim() || "",
    thumbnail:
      value.thumbnail?.trim() ||
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: value.description?.trim() || "",
    webpageUrl:
      value.webpageUrl?.trim() || `https://www.youtube.com/watch?v=${id}`,
    addedAt: Number(value.addedAt) || Date.now(),
  } satisfies StoredLiveStream;
}

async function readStoredLiveStreams() {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeStoredStream(item as Partial<StoredLiveStream>))
      .filter((item): item is StoredLiveStream => item !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function toFeedVideo(stream: StoredLiveStream): FeedVideo {
  return {
    id: stream.id,
    provider: "youtube-live",
    channelId: stream.channelId,
    channelName: stream.channelName,
    channelAvatar: stream.channelAvatar,
    title: stream.title,
    thumbnail: stream.thumbnail,
    publishedAt: null,
    duration: 0,
    downloaded: true,
    missing: false,
    watched: false,
    sourceLabel: "Live",
    description: stream.description,
    webpageUrl: stream.webpageUrl,
  };
}

function runYtDlp(videoId: string) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const args = [
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    "--js-runtimes",
    "node",
    "--extractor-args",
    "youtube:player_client=web_safari",
    "--",
    url,
  ];

  return new Promise<YtDlpInfo>((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, info?: YtDlpInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(info as YtDlpInfo);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("YouTube took too long to resolve the live stream"));
    }, commandTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 20_000_000) {
        child.kill("SIGKILL");
        finish(new Error("YouTube returned too much stream metadata"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => {
      finish(
        new Error(
          error.message.includes("ENOENT")
            ? "yt-dlp is not installed in this container"
            : error.message
        )
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
        finish(
          new Error(
            detail || `YouTube live stream resolution failed (${code ?? "unknown"})`
          )
        );
        return;
      }
      try {
        finish(undefined, JSON.parse(stdout) as YtDlpInfo);
      } catch {
        finish(new Error("YouTube returned invalid live stream metadata"));
      }
    });
  });
}

function isHlsFormat(format: YtDlpFormat) {
  return (
    format.protocol?.toLowerCase().includes("m3u8") === true ||
    format.url?.toLowerCase().includes(".m3u8") === true
  );
}

function isAppleVideoCodec(codec: string | undefined) {
  const value = (codec || "").toLowerCase();
  return value.startsWith("avc1") || value.startsWith("h264");
}

function isAppleAudioCodec(codec: string | undefined) {
  const value = (codec || "").toLowerCase();
  return value.startsWith("mp4a") || value.startsWith("aac");
}

function selectPlayback(info: YtDlpInfo): YouTubeLivePlayback {
  const formats = (info.formats || []).filter(
    (format) => Boolean(format.url) && isHlsFormat(format)
  );
  const compatible = formats.filter(
    (format) =>
      isAppleVideoCodec(format.vcodec) &&
      isAppleAudioCodec(format.acodec) &&
      format.vcodec !== "none" &&
      format.acodec !== "none"
  );
  const selected = compatible.sort(
    (left, right) =>
      (Number(right.height) || 0) - (Number(left.height) || 0) ||
      (Number(right.tbr) || 0) - (Number(left.tbr) || 0)
  )[0];
  if (!selected?.url) {
    throw new Error(
      "This live stream has no combined H.264/AAC HLS version for Apple devices"
    );
  }
  const height = Number(selected.height) || null;
  return {
    url: selected.url,
    label: height ? `YouTube Live ${height}p` : "YouTube Live",
    codec: [selected.vcodec, selected.acodec].filter(Boolean).join(" / "),
    height,
    mimeType: "application/vnd.apple.mpegurl",
    playbackMode: "hls",
  };
}

function assertCurrentlyLive(info: YtDlpInfo) {
  if (info.is_live === true || info.live_status === "is_live") return;
  if (info.live_status === "is_upcoming") {
    throw new Error("This YouTube stream has not started yet");
  }
  throw new Error("This YouTube video is not currently live");
}

export async function readLiveStreams() {
  const stored = await readStoredLiveStreams();
  return stored
    .sort((left, right) => right.addedAt - left.addedAt)
    .map(toFeedVideo);
}

export async function addLiveStream(input: string) {
  const id = extractYouTubeVideoId(input);
  if (!id) throw new Error("No valid YouTube live URL found");
  const info = await runYtDlp(id);
  assertCurrentlyLive(info);
  const playback = selectPlayback(info);
  sourceCache.set(id, { expiresAt: Date.now() + sourceCacheTtlMs, playback });

  const stream: StoredLiveStream = {
    id,
    title: info.title?.trim() || `YouTube Live ${id}`,
    channelId:
      info.channel_id?.trim() || info.uploader_id?.trim() || `live:${id}`,
    channelName:
      info.channel?.trim() || info.uploader?.trim() || "YouTube Live",
    channelAvatar: "",
    thumbnail:
      info.thumbnail?.trim() || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: info.description?.trim() || "",
    webpageUrl:
      info.webpage_url?.trim() || `https://www.youtube.com/watch?v=${id}`,
    addedAt: Date.now(),
  };

  const result = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readStoredLiveStreams();
      const next = [stream, ...current.filter((item) => item.id !== id)].slice(0, 100);
      await writeJsonAtomic(storePath, next);
      return toFeedVideo(stream);
    });
  writeQueue = result;
  return result;
}

export async function removeLiveStream(videoId: string) {
  if (!isValidVideoId(videoId)) throw new Error("Invalid live stream ID");
  const result = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readStoredLiveStreams();
      const next = current.filter((stream) => stream.id !== videoId);
      await writeJsonAtomic(storePath, next);
      sourceCache.delete(videoId);
      return next
        .sort((left, right) => right.addedAt - left.addedAt)
        .map(toFeedVideo);
    });
  writeQueue = result;
  return result;
}

export async function getLivePlayback(
  videoId: string,
  options: { refresh?: boolean } = {}
) {
  if (!isValidVideoId(videoId)) throw new Error("Invalid live stream ID");
  const exists = (await readStoredLiveStreams()).some(
    (stream) => stream.id === videoId
  );
  if (!exists) throw new Error("Live stream is not saved");

  const cached = sourceCache.get(videoId);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.playback;
  }

  const info = await runYtDlp(videoId);
  assertCurrentlyLive(info);
  const playback = selectPlayback(info);
  sourceCache.set(videoId, {
    expiresAt: Date.now() + sourceCacheTtlMs,
    playback,
  });
  return playback;
}
