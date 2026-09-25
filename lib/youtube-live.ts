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

type YouTubePlayerResponse = {
  videoDetails?: {
    videoId?: string;
    title?: string;
    channelId?: string;
    author?: string;
    shortDescription?: string;
    isLive?: boolean;
    thumbnail?: { thumbnails?: Array<{ url?: string }> };
  };
  streamingData?: { hlsManifestUrl?: string };
};

const livePlayerClients = [
  "web_safari",
  "web_embedded",
  "tv_simply",
  "default",
] as const;

export type YouTubeLivePlayback = {
  url: string;
  label: string;
  codec: string;
  height: number | null;
  mimeType: string;
  playbackMode: "hls" | "embed";
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

function runYtDlpOnce(videoId: string, playerClient: string) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const args = [
    "--ignore-config",
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    "--extractor-args",
    `youtube:player_client=${playerClient}`,
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

function extractPlayerResponse(html: string): YouTubePlayerResponse | null {
  const marker = "ytInitialPlayerResponse =";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1)) as YouTubePlayerResponse;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function runYouTubePageFallback(videoId: string) {
  const pageUrls = Array.from({ length: 8 }, (_, index) => {
    const suffixes = [
      "",
      "&hl=en&gl=US",
      "&bpctr=9999999999",
      "&hl=en&gl=US&app=desktop",
    ];
    return `https://www.youtube.com/watch?v=${videoId}${suffixes[index % suffixes.length]}`;
  });
  let playerResponse: YouTubePlayerResponse | null = null;
  let lastError: Error | null = null;
  for (const pageUrl of pageUrls) {
    try {
      const response = await fetch(pageUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`YouTube page request failed (${response.status})`);
      }
      const candidate = extractPlayerResponse(await response.text());
      if (!candidate) {
        throw new Error("YouTube did not return a playable player response");
      }
      playerResponse = candidate;
      if (candidate.streamingData?.hlsManifestUrl) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (!playerResponse) throw lastError || new Error("YouTube page request failed");

  const details = playerResponse.videoDetails || {};
  const hlsManifestUrl = playerResponse.streamingData?.hlsManifestUrl;
  return {
    id: details.videoId || videoId,
    title: details.title,
    channel: details.author,
    channel_id: details.channelId,
    thumbnail: details.thumbnail?.thumbnails?.at(-1)?.url,
    description: details.shortDescription,
    webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
    is_live: details.isLive,
    live_status: details.isLive ? "is_live" : undefined,
    formats: hlsManifestUrl
      ? [
          {
            url: hlsManifestUrl,
            protocol: "m3u8",
            vcodec: "avc1",
            acodec: "mp4a",
            format_id: "youtube-page-hls",
            ext: "mp4",
          },
        ]
      : [],
  } satisfies YtDlpInfo;
}

async function runYtDlp(videoId: string) {
  let lastError: Error | null = null;
  let lastInfo: YtDlpInfo | null = null;

  try {
    const info = await runYouTubePageFallback(videoId);
    if (
      (info.formats || []).some(
        (format) =>
          Boolean(format.url) &&
          isHlsFormat(format) &&
          isAppleVideoCodec(format.vcodec) &&
          isAppleAudioCodec(format.acodec)
      )
    ) {
      return info;
    }
    lastInfo = info;
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
  }

  for (const playerClient of livePlayerClients) {
    try {
      const info = await runYtDlpOnce(videoId, playerClient);
      lastInfo = info;
      const hasCompatibleHls = (info.formats || []).some(
        (format) =>
          Boolean(format.url) &&
          isHlsFormat(format) &&
          isAppleVideoCodec(format.vcodec) &&
          isAppleAudioCodec(format.acodec)
      );
      if (hasCompatibleHls) return info;
      lastError = new Error("YouTube returned no playable HLS formats");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!/no video formats|formats found|no playable formats/i.test(lastError.message)) {
        if (lastInfo?.is_live === true) break;
        throw lastError;
      }
    }
  }
  if (lastInfo && (lastInfo.is_live === true || !lastError)) return lastInfo;
  throw new Error(
    lastError && /no video formats|formats found|no playable formats/i.test(lastError.message)
      ? "YouTube did not expose a playable HLS format for this live stream. Check that it is public and currently live, then retry."
      : lastError?.message || "YouTube live stream resolution failed"
  );
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
    if (info.is_live === true && info.id) {
      return {
        url: `https://www.youtube.com/embed/${encodeURIComponent(
          info.id
        )}?autoplay=1&playsinline=1&rel=0`,
        label: "YouTube Live player",
        codec: "YouTube player",
        height: null,
        mimeType: "text/html",
        playbackMode: "embed",
      };
    }
    throw new Error(
      "YouTube did not expose a combined H.264/AAC HLS version for Apple devices"
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
