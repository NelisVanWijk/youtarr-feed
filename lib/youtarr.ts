import type {
  Channel,
  ConnectionStatus,
  DownloadActivity,
  FeedVideo,
  ServiceDiagnostic,
  SettingValue,
  YoutarrDiagnostics,
} from "./types";

type YoutarrChannel = {
  channel_id?: string;
  uploader?: string;
  url?: string;
  auto_download_enabled_tabs?: string;
  video_quality?: string | null;
};

type YoutarrVideo = {
  youtube_id?: string;
  youtubeId?: string;
  title?: string;
  thumbnail?: string;
  publishedAt?: string | null;
  duration?: number;
  added?: boolean;
  removed?: boolean;
  youtube_removed?: boolean;
  watchedBy?: string[];
  filePath?: string | null;
  audioFilePath?: string | null;
};

type YoutarrChannelInfo = YoutarrChannel & {
  id?: string;
  title?: string;
  enabled?: boolean;
  existing?: boolean;
};

type YoutarrActivitySnapshot = {
  capturedAt?: number | null;
  terminal?: boolean;
  activity?: {
    progress?: {
      state?: string;
      percent?: number;
      etaSeconds?: number;
      speedBytesPerSecond?: number;
    };
    videoCount?: {
      current?: number;
      total?: number;
      completed?: number;
      skipped?: number;
    };
    text?: string;
    finalSummary?: {
      totalDownloaded?: number;
      totalFailed?: number;
      totalSkipped?: number;
    };
  } | null;
  lastFinalActivity?: YoutarrActivitySnapshot["activity"];
};
type OrderedFeedVideo = FeedVideo & {
  sourceOrder: number;
};

type YoutarrVideoLocation = {
  filePath: string | null;
  audioFilePath: string | null;
  downloaded: boolean;
  removed: boolean;
};

type QueueDownloadOptions = {
  allowRedownload?: boolean;
  channelId?: string;
};

export type YoutarrPlaybackProfile = "primary" | "av1" | "vp9";

type YoutarrInstanceConfig = {
  key: YoutarrPlaybackProfile;
  label: string;
  url: string;
  sessionToken: string;
  username: string;
  password: string;
  apiKey: string;
  authDisabled: boolean;
  mediaDirectory: string;
  sourceMediaDirectory: string;
};

export type YoutarrVideoMetadata = {
  description?: string | null;
  likeCount?: number | null;
  webpageUrl?: string | null;
};

const configuredUrl = process.env.YOUTARR_URL?.trim().replace(/\/+$/, "") || "";
const configuredSession = process.env.YOUTARR_SESSION_TOKEN?.trim() || "";
const configuredUser = process.env.YOUTARR_USERNAME?.trim() || "";
const configuredPassword = process.env.YOUTARR_PASSWORD || "";
const configuredApiKey = process.env.YOUTARR_API_KEY?.trim() || "";
const configuredYouTubeApiKey = process.env.YOUTUBE_API_KEY?.trim() || "";
const authDisabled = process.env.YOUTARR_AUTH_DISABLED === "true";
const configuredMediaDirectory = process.env.YOUTARR_MEDIA_DIR?.trim() || "";
const configuredSourceMediaDirectory =
  process.env.YOUTARR_SOURCE_MEDIA_DIR?.trim() || "/usr/src/app/data";
const configuredPlaybackProfile =
  process.env.YOUTARR_PLAYBACK_PROFILE?.trim().toLowerCase() || "auto";

const primaryInstance: YoutarrInstanceConfig = {
  key: "primary",
  label: "Youtarr",
  url: configuredUrl,
  sessionToken: configuredSession,
  username: configuredUser,
  password: configuredPassword,
  apiKey: configuredApiKey,
  authDisabled,
  mediaDirectory: configuredMediaDirectory,
  sourceMediaDirectory: configuredSourceMediaDirectory,
};

function cleanUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function optionalPlaybackInstance(
  key: "av1" | "vp9",
  label: string,
  prefix: "YOUTARR_AV1" | "YOUTARR_VP9"
): YoutarrInstanceConfig | null {
  const url = cleanUrl(process.env[`${prefix}_URL`]);
  if (!url) return null;
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim() || "";
  const usesExplicitApiKeyOnly =
    Boolean(apiKey) &&
    !process.env[`${prefix}_USERNAME`]?.trim() &&
    !process.env[`${prefix}_PASSWORD`] &&
    !process.env[`${prefix}_SESSION_TOKEN`]?.trim();
  return {
    key,
    label,
    url,
    sessionToken:
      process.env[`${prefix}_SESSION_TOKEN`]?.trim() ||
      (usesExplicitApiKeyOnly ? "" : configuredSession),
    username:
      process.env[`${prefix}_USERNAME`]?.trim() ||
      (usesExplicitApiKeyOnly ? "" : configuredUser),
    password:
      process.env[`${prefix}_PASSWORD`] ||
      (usesExplicitApiKeyOnly ? "" : configuredPassword),
    apiKey: apiKey || configuredApiKey,
    authDisabled:
      process.env[`${prefix}_AUTH_DISABLED`] === "true" || authDisabled,
    mediaDirectory: process.env[`${prefix}_MEDIA_DIR`]?.trim() || "",
    sourceMediaDirectory:
      process.env[`${prefix}_SOURCE_MEDIA_DIR`]?.trim() ||
      configuredSourceMediaDirectory,
  };
}

const playbackInstances: Record<YoutarrPlaybackProfile, YoutarrInstanceConfig | null> = {
  primary: primaryInstance,
  av1: optionalPlaybackInstance("av1", "Youtarr AV1", "YOUTARR_AV1"),
  vp9: optionalPlaybackInstance("vp9", "Youtarr VP9", "YOUTARR_VP9"),
};

let cachedToken = configuredSession;
let tokenExpiresAt = configuredSession ? Number.POSITIVE_INFINITY : 0;
const instanceTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();
let youtubeApiBackoffUntil = 0;
const youtubePublishedAtCache = new Map<string, string | null>();
const youtarrLocationCache = new Map<
  string,
  YoutarrVideoLocation & { expiresAt: number }
>();
const locationCacheHitTtlMs = 5 * 60 * 1000;
const locationCacheMissTtlMs = 15 * 1000;
const youtarrLocationScanPromises = new Map<string, Promise<void>>();

export function isYoutarrConfigured() {
  return isYoutarrInstanceConfigured(primaryInstance);
}

function isYoutarrInstanceConfigured(instance: YoutarrInstanceConfig | null) {
  return Boolean(
    instance?.url &&
      (instance.authDisabled ||
        instance.sessionToken ||
        (instance.username && instance.password) ||
        instance.apiKey)
  );
}

export function getYoutarrPublicConfig() {
  return {
    configured: isYoutarrConfigured(),
    server: configuredUrl
      ? configuredUrl.replace(/^https?:\/\//, "").split("/")[0]
      : undefined,
  };
}

function isIpadOrMacSafari(userAgent?: string | null) {
  if (!userAgent) return false;
  const isSafari =
    /\bSafari\b/i.test(userAgent) &&
    !/\b(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)\b/i.test(userAgent);
  return /\biPad\b/i.test(userAgent) || (/\bMacintosh\b/i.test(userAgent) && isSafari);
}

function isIphone(userAgent?: string | null) {
  return Boolean(userAgent && /\biPhone\b/i.test(userAgent));
}

function configuredPlaybackInstance(profile: YoutarrPlaybackProfile) {
  const instance = playbackInstances[profile];
  return isYoutarrInstanceConfigured(instance) ? instance : null;
}

export function selectYoutarrPlaybackProfile(
  userAgent?: string | null
): YoutarrPlaybackProfile {
  if (
    configuredPlaybackProfile === "av1" ||
    configuredPlaybackProfile === "vp9" ||
    configuredPlaybackProfile === "primary"
  ) {
    return configuredPlaybackInstance(configuredPlaybackProfile)
      ? configuredPlaybackProfile
      : "primary";
  }

  if (isIpadOrMacSafari(userAgent) && configuredPlaybackInstance("vp9")) {
    return "vp9";
  }
  if (isIphone(userAgent) && configuredPlaybackInstance("av1")) {
    return "av1";
  }
  return "primary";
}

export function getYoutarrPlaybackTarget(userAgent?: string | null) {
  const profile = selectYoutarrPlaybackProfile(userAgent);
  const instance = configuredPlaybackInstance(profile) || primaryInstance;
  return {
    profile: instance.key,
    label: instance.label,
    configured: isYoutarrInstanceConfigured(instance),
    media: {
      mediaDirectory: instance.mediaDirectory,
      sourceMediaDirectory: instance.sourceMediaDirectory,
    },
  };
}

function playbackInstanceForProfile(profile: YoutarrPlaybackProfile) {
  return configuredPlaybackInstance(profile) || primaryInstance;
}

function configuredSecondaryPlaybackInstances() {
  return Object.values(playbackInstances).filter(
    (instance): instance is YoutarrInstanceConfig =>
      Boolean(instance) &&
      instance.key !== "primary" &&
      isYoutarrInstanceConfigured(instance)
  );
}

function hasOwnEnv(prefix: "YOUTARR" | "YOUTARR_AV1" | "YOUTARR_VP9", key: string) {
  return Boolean(process.env[`${prefix}_${key}`]?.trim());
}

function secretState(value: string) {
  return value ? "Set" : "Not set";
}

function authMethod(instance: YoutarrInstanceConfig) {
  if (instance.authDisabled) return "Auth disabled";
  if (instance.sessionToken) return "Session token";
  if (instance.username && instance.password) return "Username/password";
  if (instance.apiKey) return "API key only";
  return "Missing";
}

function inheritedValue(
  prefix: "YOUTARR_AV1" | "YOUTARR_VP9",
  key: "USERNAME" | "PASSWORD" | "SESSION_TOKEN" | "API_KEY",
  value: string
) {
  if (!value) return "Not set";
  return hasOwnEnv(prefix, key) ? "Set" : "Inherited";
}

function youtarrSettings(
  instance: YoutarrInstanceConfig,
  prefix: "YOUTARR" | "YOUTARR_AV1" | "YOUTARR_VP9"
): SettingValue[] {
  const ownSecret = (key: "USERNAME" | "PASSWORD" | "SESSION_TOKEN" | "API_KEY", value: string) =>
    prefix === "YOUTARR" ? secretState(value) : inheritedValue(prefix, key, value);

  return [
    { key: `${prefix}_URL`, label: "URL", value: instance.url || "Not set" },
    {
      key: `${prefix}_AUTH`,
      label: "Auth method",
      value: authMethod(instance),
    },
    {
      key: `${prefix}_USERNAME`,
      label: "Username",
      value: ownSecret("USERNAME", instance.username),
      secret: true,
    },
    {
      key: `${prefix}_PASSWORD`,
      label: "Password",
      value: ownSecret("PASSWORD", instance.password),
      secret: true,
    },
    {
      key: `${prefix}_SESSION_TOKEN`,
      label: "Session token",
      value: ownSecret("SESSION_TOKEN", instance.sessionToken),
      secret: true,
    },
    {
      key: `${prefix}_API_KEY`,
      label: "API key",
      value: ownSecret("API_KEY", instance.apiKey),
      secret: true,
    },
    {
      key: `${prefix}_MEDIA_DIR`,
      label: "Media directory",
      value: instance.mediaDirectory || "Not set",
    },
    {
      key: `${prefix}_SOURCE_MEDIA_DIR`,
      label: "Source media directory",
      value: instance.sourceMediaDirectory || "Not set",
    },
  ];
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function checkYoutarrInstance(
  instance: YoutarrInstanceConfig | null
): Promise<ConnectionStatus> {
  if (!instance?.url) return { ok: false, message: "URL is not set" };
  if (!isYoutarrInstanceConfigured(instance)) {
    return { ok: false, message: "Authentication is not configured" };
  }

  const timeout = timeoutSignal(8000);
  try {
    const response = await requestYoutarrInstance(
      instance,
      "/getchannels?page=1&pageSize=1&sortBy=name&sortOrder=asc",
      { signal: timeout.signal }
    );
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `Connection failed (${response.status})`,
      };
    }
    const data = (await response.json().catch(() => ({}))) as {
      totalChannels?: number;
      channels?: unknown[];
    };
    const count =
      typeof data.totalChannels === "number"
        ? `${data.totalChannels} channels`
        : Array.isArray(data.channels)
          ? `${data.channels.length}+ channels`
          : "Connected";
    return { ok: true, status: response.status, message: count };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === "AbortError"
          ? "Connection timed out"
          : error instanceof Error
            ? error.message
            : "Connection failed",
    };
  } finally {
    timeout.clear();
  }
}

async function youtarrDiagnostic(
  instance: YoutarrInstanceConfig | null,
  prefix: "YOUTARR" | "YOUTARR_AV1" | "YOUTARR_VP9",
  fallback: YoutarrInstanceConfig
): Promise<ServiceDiagnostic> {
  const resolved = instance || fallback;
  return {
    key: resolved.key,
    label: resolved.label,
    configured: isYoutarrInstanceConfigured(instance),
    connection: await checkYoutarrInstance(instance),
    settings: youtarrSettings(resolved, prefix),
  };
}

export async function getYoutarrDiagnostics(): Promise<YoutarrDiagnostics> {
  return {
    playbackProfile: configuredPlaybackProfile,
    effectiveProfiles: {
      ipadMacSafari: selectYoutarrPlaybackProfile(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
      ),
      iphone: selectYoutarrPlaybackProfile(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      ),
      fallback: selectYoutarrPlaybackProfile("Mozilla/5.0"),
    },
    instances: await Promise.all([
      youtarrDiagnostic(primaryInstance, "YOUTARR", primaryInstance),
      youtarrDiagnostic(playbackInstances.vp9, "YOUTARR_VP9", {
        ...primaryInstance,
        key: "vp9",
        label: "Youtarr VP9",
        url: "",
        mediaDirectory: "",
      }),
      youtarrDiagnostic(playbackInstances.av1, "YOUTARR_AV1", {
        ...primaryInstance,
        key: "av1",
        label: "Youtarr AV1",
        url: "",
        mediaDirectory: "",
      }),
    ]),
  };
}

function cacheKey(instanceKey: string, youtubeId: string) {
  return `${instanceKey}:${youtubeId}`;
}

async function login() {
  if (authDisabled) return "";
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  if (configuredApiKey && !configuredUser && !configuredPassword) return "";
  if (!configuredUser || !configuredPassword) {
    throw new Error("Youtarr-inloggegevens ontbreken");
  }

  const response = await fetch(`${configuredUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: configuredUser,
      password: configuredPassword,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Youtarr rejected the login credentials"
        : `Youtarr login failed (${response.status})`
    );
  }

  const data = (await response.json()) as { token?: string; expires?: string };
  if (!data.token) throw new Error("Youtarr did not return a session");
  cachedToken = data.token;
  tokenExpiresAt = data.expires
    ? new Date(data.expires).getTime()
    : Date.now() + 6 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

async function requestYoutarr(
  path: string,
  init: RequestInit = {},
  retry = true
): Promise<Response> {
  if (!configuredUrl) throw new Error("YOUTARR_URL is missing");
  const token = await login();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-access-token", token);
  if (!token && configuredApiKey) headers.set("x-api-key", configuredApiKey);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${configuredUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (retry && !authDisabled && !configuredSession && (response.status === 401 || response.status === 403)) {
    cachedToken = "";
    tokenExpiresAt = 0;
    return requestYoutarr(path, init, false);
  }
  return response;
}

async function loginInstance(instance: YoutarrInstanceConfig) {
  if (instance.authDisabled) return "";
  const cached = instanceTokenCache.get(instance.key);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  if (instance.sessionToken) {
    instanceTokenCache.set(instance.key, {
      token: instance.sessionToken,
      expiresAt: Number.POSITIVE_INFINITY,
    });
    return instance.sessionToken;
  }
  if (instance.apiKey && (!instance.username || !instance.password)) return "";
  if (!instance.username || !instance.password) {
    throw new Error(`${instance.label} login credentials are missing`);
  }

  const response = await fetch(`${instance.url}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: instance.username,
      password: instance.password,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? `${instance.label} rejected the login credentials`
        : `${instance.label} login failed (${response.status})`
    );
  }

  const data = (await response.json()) as { token?: string; expires?: string };
  if (!data.token) throw new Error(`${instance.label} did not return a session`);
  instanceTokenCache.set(instance.key, {
    token: data.token,
    expiresAt: data.expires
      ? new Date(data.expires).getTime()
      : Date.now() + 6 * 24 * 60 * 60 * 1000,
  });
  return data.token;
}

async function requestYoutarrInstance(
  instance: YoutarrInstanceConfig,
  path: string,
  init: RequestInit = {},
  retry = true
) {
  if (instance.key === "primary") {
    return requestYoutarr(path, init, retry);
  }
  if (!instance.url) throw new Error(`${instance.label} URL is missing`);
  const token = await loginInstance(instance);
  const headers = new Headers(init.headers);
  if (token) headers.set("x-access-token", token);
  if (!token && instance.apiKey) headers.set("x-api-key", instance.apiKey);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${instance.url}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (
    retry &&
    !instance.authDisabled &&
    !instance.sessionToken &&
    (response.status === 401 || response.status === 403)
  ) {
    instanceTokenCache.delete(instance.key);
    return requestYoutarrInstance(instance, path, init, false);
  }
  return response;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await requestYoutarr(path);
  if (!response.ok) {
    throw new Error(`Youtarr request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function getJsonFromInstance<T>(
  instance: YoutarrInstanceConfig,
  path: string
): Promise<T> {
  const response = await requestYoutarrInstance(instance, path);
  if (!response.ok) {
    throw new Error(`${instance.label} request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function toChannel(channel: YoutarrChannel): Channel {
  const id = channel.channel_id || "";
  return {
    id,
    name: channel.uploader || "Untitled channel",
    url: channel.url || "",
    avatar: id ? `/api/channel-avatar/${encodeURIComponent(id)}` : "",
    autoDownload: (channel.auto_download_enabled_tabs || "")
      .split(",")
      .includes("video"),
    videoQuality: channel.video_quality,
  };
}

function toVideo(video: YoutarrVideo, channel: Channel): FeedVideo | null {
  const id = video.youtube_id || video.youtubeId || "";
  if (!id) return null;
  const added = video.added === true;
  const removed = video.removed === true;
  rememberYoutarrVideoLocation(id, {
    filePath: video.filePath || null,
    audioFilePath: video.audioFilePath || null,
    downloaded: added,
    removed,
  });
  return {
    id,
    channelId: channel.id,
    channelName: channel.name,
    channelAvatar: channel.avatar,
    title: video.title || "Untitled video",
    thumbnail:
      video.thumbnail && !video.thumbnail.startsWith("/")
        ? video.thumbnail
        : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: video.publishedAt || null,
    duration: Number(video.duration) || 0,
    downloaded: added && !removed,
    missing: added && removed,
    watched: Boolean(video.watchedBy?.length),
    removedFromYouTube: video.youtube_removed === true,
    filePath: video.filePath || null,
  };
}

function isValidYoutubeId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function rememberYoutarrVideoLocation(
  youtubeId: string,
  location: YoutarrVideoLocation,
  instanceKey: YoutarrPlaybackProfile = "primary"
) {
  if (!isValidYoutubeId(youtubeId)) return;
  const hasUsablePath = Boolean(location.filePath || location.audioFilePath);
  youtarrLocationCache.set(cacheKey(instanceKey, youtubeId), {
    ...location,
    expiresAt:
      Date.now() + (hasUsablePath ? locationCacheHitTtlMs : locationCacheMissTtlMs),
  });
}

function fromYoutarrVideoLocation(video: YoutarrVideo): YoutarrVideoLocation {
  const downloaded = video.added === true || Boolean(video.filePath || video.audioFilePath);
  const removed = video.removed === true;
  return {
    filePath: video.filePath || null,
    audioFilePath: video.audioFilePath || null,
    downloaded,
    removed,
  };
}

export function clearYoutarrVideoLocationCache(youtubeId: string) {
  if (!isValidYoutubeId(youtubeId)) return;
  for (const key of youtarrLocationCache.keys()) {
    if (key.endsWith(`:${youtubeId}`)) youtarrLocationCache.delete(key);
  }
}

function readCachedYoutarrVideoLocationForInstance(
  instance: YoutarrInstanceConfig,
  youtubeId: string
) {
  const cached = youtarrLocationCache.get(cacheKey(instance.key, youtubeId));
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return {
    filePath: cached.filePath,
    audioFilePath: cached.audioFilePath,
    downloaded: cached.downloaded,
    removed: cached.removed,
  };
}

async function scanYoutarrVideoLocations(instance = primaryInstance) {
  const pageSize = 250;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await getJsonFromInstance<{
      videos?: YoutarrVideo[];
      totalPages?: number;
    }>(
      instance,
      `/getVideos?page=${page}&limit=${pageSize}&sortBy=added&sortOrder=desc&missingFilter=off`
    );

    for (const video of data.videos || []) {
      const youtubeId = video.youtubeId || video.youtube_id || "";
      if (youtubeId) {
        rememberYoutarrVideoLocation(
          youtubeId,
          fromYoutarrVideoLocation(video),
          instance.key
        );
      }
    }

    const totalPages = Math.max(1, data.totalPages || 1);
    if (page >= totalPages) break;
  }
}

async function refreshYoutarrVideoLocationCache(instance = primaryInstance) {
  const key = instance.key;
  const existing = youtarrLocationScanPromises.get(key);
  if (existing) return existing;
  const next = scanYoutarrVideoLocations(instance).finally(() => {
    youtarrLocationScanPromises.delete(key);
  });
  youtarrLocationScanPromises.set(key, next);
  return next;
}

export async function getYoutarrVideoLocation(
  youtubeId: string,
  profile: YoutarrPlaybackProfile = "primary"
): Promise<YoutarrVideoLocation | null> {
  const instance = playbackInstanceForProfile(profile);
  if (!isValidYoutubeId(youtubeId) || !isYoutarrInstanceConfigured(instance)) {
    return null;
  }

  const cached = readCachedYoutarrVideoLocationForInstance(instance, youtubeId);
  if (cached) return cached;

  await refreshYoutarrVideoLocationCache(instance);
  const refreshed = readCachedYoutarrVideoLocationForInstance(instance, youtubeId);
  if (refreshed) return refreshed;

  const missing = {
    filePath: null,
    audioFilePath: null,
    downloaded: false,
    removed: false,
  };
  rememberYoutarrVideoLocation(youtubeId, missing, instance.key);
  return missing;
}

export async function getYoutarrVideoMetadata(
  youtubeId: string
): Promise<YoutarrVideoMetadata> {
  if (!isValidYoutubeId(youtubeId)) throw new Error("Invalid video ID");
  const response = await requestYoutarr(
    `/api/videos/${encodeURIComponent(youtubeId)}/metadata`
  );
  if (!response.ok) {
    throw new Error(`Youtarr metadata request failed (${response.status})`);
  }
  return (await response.json()) as YoutarrVideoMetadata;
}

function toOrderedVideo(
  video: YoutarrVideo,
  channel: Channel,
  sourceOrder: number
): OrderedFeedVideo | null {
  const mapped = toVideo(video, channel);
  return mapped ? { ...mapped, sourceOrder } : null;
}

function publishedSortTime(value: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByPublishedDateThenSourceOrder(
  left: OrderedFeedVideo,
  right: OrderedFeedVideo
) {
  const timeDifference =
    publishedSortTime(right.publishedAt) - publishedSortTime(left.publishedAt);
  if (timeDifference !== 0) return timeDifference;
  return left.sourceOrder - right.sourceOrder;
}

function stripSourceOrder(video: OrderedFeedVideo): FeedVideo {
  const feedVideo: Partial<OrderedFeedVideo> = { ...video };
  delete feedVideo.sourceOrder;
  return feedVideo as FeedVideo;
}

function needsPublishedAtEnrichment(video: FeedVideo) {
  if (!video.publishedAt) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(video.publishedAt)) return true;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?Z$/.test(
    video.publishedAt
  );
}

async function enrichPublishedTimes(videos: OrderedFeedVideo[]) {
  if (!configuredYouTubeApiKey || Date.now() < youtubeApiBackoffUntil) return;

  const ids = [
    ...new Set(
      videos
        .filter(needsPublishedAtEnrichment)
        .map((video) => video.id)
        .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id))
    ),
  ].filter((id) => !youtubePublishedAtCache.has(id));

  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", configuredYouTubeApiKey);

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        youtubeApiBackoffUntil = Date.now() + 5 * 60 * 1000;
        break;
      }

      const data = (await response.json()) as {
        items?: Array<{ id?: string; snippet?: { publishedAt?: string } }>;
      };
      const found = new Set<string>();
      for (const item of data.items || []) {
        if (item.id) {
          youtubePublishedAtCache.set(
            item.id,
            item.snippet?.publishedAt || null
          );
          found.add(item.id);
        }
      }
      for (const id of batch) {
        if (!found.has(id)) youtubePublishedAtCache.set(id, null);
      }
    } catch {
      youtubeApiBackoffUntil = Date.now() + 5 * 60 * 1000;
      break;
    }
  }

  for (const video of videos) {
    const publishedAt = youtubePublishedAtCache.get(video.id);
    if (publishedAt) video.publishedAt = publishedAt;
  }
}

export async function getChannels(): Promise<Channel[]> {
  const first = await getJson<{
    channels?: YoutarrChannel[];
    totalPages?: number;
  }>("/getchannels?page=1&pageSize=100&sortBy=name&sortOrder=asc");
  const rows = [...(first.channels || [])];
  const totalPages = Math.min(Math.max(first.totalPages || 1, 1), 20);

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await getJson<{ channels?: YoutarrChannel[] }>(
      `/getchannels?page=${page}&pageSize=100&sortBy=name&sortOrder=asc`
    );
    rows.push(...(next.channels || []));
  }
  return rows.map(toChannel).filter((channel) => channel.id);
}

async function fetchChannelVideos(
  channel: Channel,
  page = 1,
  pageSize = 16
): Promise<FeedVideo[]> {
  const query = (downloadedFilter: "off" | "only", requestedPageSize: number) =>
    `/getchannelvideos/${encodeURIComponent(channel.id)}?page=${page}&pageSize=${requestedPageSize}&tabType=videos&sortBy=date&sortOrder=desc&downloadedFilter=${downloadedFilter}`;

  const data = await getJson<{ videos?: YoutarrVideo[] }>(
    query("off", pageSize)
  );
  const downloadedData = await getJson<{ videos?: YoutarrVideo[] }>(
    query("only", Math.max(pageSize, 100))
  );

  const merged = new Map<string, OrderedFeedVideo>();
  [...(data.videos || []), ...(downloadedData.videos || [])]
    .map((video, index) => toOrderedVideo(video, channel, index))
    .filter((video): video is OrderedFeedVideo => video !== null)
    .forEach((video) => {
      const current = merged.get(video.id);
      merged.set(
        video.id,
        current
          ? { ...current, ...video, sourceOrder: current.sourceOrder }
          : video
      );
    });

  return [...merged.values()].map(stripSourceOrder);
}

async function fetchDownloadedChannelVideos(
  channel: Channel
): Promise<OrderedFeedVideo[]> {
  const data = await getJson<{ videos?: YoutarrVideo[] }>(
    `/getchannelvideos/${encodeURIComponent(channel.id)}?page=1&pageSize=300&tabType=videos&sortBy=date&sortOrder=desc&downloadedFilter=only`
  );
  return (data.videos || [])
    .map((video, index) => toOrderedVideo(video, channel, index))
    .filter(
      (video): video is OrderedFeedVideo => video !== null && video.downloaded
    );
}

export async function getFeed(): Promise<{
  channels: Channel[];
  videos: FeedVideo[];
  warnings: string[];
}> {
  const channels = await getChannels();
  const videos: OrderedFeedVideo[] = [];
  const warnings: string[] = [];
  const batchSize = 4;

  for (let index = 0; index < channels.length; index += batchSize) {
    const batch = channels.slice(index, index + batchSize);
    const results = await Promise.allSettled(
      batch.map((channel) => fetchChannelVideos(channel))
    );
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        videos.push(
          ...result.value.map((video, videoIndex) => ({
            ...video,
            sourceOrder: (index + resultIndex) * 10_000 + videoIndex,
          }))
        );
      } else {
        warnings.push(`${batch[resultIndex].name} kon niet worden bijgewerkt`);
      }
    });
  }

  await enrichPublishedTimes(videos);
  videos.sort(sortByPublishedDateThenSourceOrder);

  return {
    channels,
    videos: videos.slice(0, 160).map(stripSourceOrder),
    warnings,
  };
}

export async function getVideosForChannel(channelId: string, page = 1) {
  const channels = await getChannels();
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) throw new Error("Channel not found");
  const videos = await fetchChannelVideos(channel, page, 36);
  return { channel, videos };
}

export async function getDownloadedVideos(): Promise<{
  channels: Channel[];
  videos: FeedVideo[];
  warnings: string[];
}> {
  const channels = await getChannels();
  const videos: OrderedFeedVideo[] = [];
  const warnings: string[] = [];
  const batchSize = 4;

  for (let index = 0; index < channels.length; index += batchSize) {
    const batch = channels.slice(index, index + batchSize);
    const results = await Promise.allSettled(
      batch.map((channel) => fetchDownloadedChannelVideos(channel))
    );
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        videos.push(
          ...result.value.map((video, videoIndex) => ({
            ...video,
            sourceOrder: (index + resultIndex) * 10_000 + videoIndex,
          }))
        );
      } else {
        warnings.push(`${batch[resultIndex].name} local videos could not be loaded`);
      }
    });
  }

  await enrichPublishedTimes(videos);
  videos.sort(sortByPublishedDateThenSourceOrder);

  return { channels, videos: videos.map(stripSourceOrder), warnings };
}

export async function queueDownload(
  youtubeId: string,
  options: QueueDownloadOptions = {}
) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    throw new Error("Invalid video ID");
  }
  const result = await queueDownloadOnInstance(
    primaryInstance,
    youtubeId,
    await queueOptionsForInstance(primaryInstance, youtubeId, options)
  );
  const secondaryInstances = configuredSecondaryPlaybackInstances();
  const secondaryResults = await Promise.allSettled(
    secondaryInstances.map(async (instance) => {
      const instanceOptions = await queueOptionsForInstance(
        instance,
        youtubeId,
        options
      );
      return queueDownloadOnInstance(instance, youtubeId, instanceOptions);
    })
  );
  const failures = secondaryResults
    .map((secondaryResult, index) =>
      secondaryResult.status === "rejected"
        ? `${secondaryInstances[index].label}: ${
            secondaryResult.reason instanceof Error
              ? secondaryResult.reason.message
              : "unknown error"
          }`
        : ""
    )
    .filter(Boolean);
  clearYoutarrVideoLocationCache(youtubeId);
  if (failures.length > 0) {
    throw new Error(
      `Download was queued on the main Youtarr instance, but not every playback instance. ${failures.join("; ")}`
    );
  }
  return result;
}

function locationNeedsRedownload(location: YoutarrVideoLocation | null) {
  if (!location) return false;
  return (
    location.removed ||
    (location.downloaded && !location.filePath && !location.audioFilePath)
  );
}

async function queueOptionsForInstance(
  instance: YoutarrInstanceConfig,
  youtubeId: string,
  options: QueueDownloadOptions
): Promise<QueueDownloadOptions> {
  if (options.allowRedownload) return options;

  const location = await getYoutarrVideoLocation(youtubeId, instance.key).catch(
    () => null
  );
  if (!locationNeedsRedownload(location)) return options;
  return { ...options, allowRedownload: true };
}

async function queueDownloadOnInstance(
  instance: YoutarrInstanceConfig,
  youtubeId: string,
  options: QueueDownloadOptions = {}
) {
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;
  const body =
    options.allowRedownload
      ? {
          urls: [url],
          overrideSettings: {
            allowRedownload: true,
          },
          ...(options.channelId && /^UC[A-Za-z0-9_-]{22}$/.test(options.channelId)
            ? { videoChannelMap: { [youtubeId]: options.channelId } }
            : {}),
        }
      : {
          url,
        };
  const headers = new Headers({ "Content-Type": "application/json" });
  let response: Response;
  if (options.allowRedownload) {
    response = await requestYoutarrInstance(instance, "/triggerspecificdownloads", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } else {
    response = await requestYoutarrInstance(instance, "/api/videos/download", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    status?: string;
    error?: string;
    message?: string;
  };
  if (!response.ok || data.success === false || data.status === "error") {
    throw new Error(
      data.error || data.message || `Could not start download (${response.status})`
    );
  }
  return data;
}

export async function deleteDownload(youtubeId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    throw new Error("Invalid video ID");
  }

  const result = await deleteDownloadFromInstance(primaryInstance, youtubeId);
  const secondaryDeletes = configuredSecondaryPlaybackInstances().map((instance) =>
    deleteDownloadFromInstance(instance, youtubeId)
  );
  await Promise.allSettled(secondaryDeletes);
  clearYoutarrVideoLocationCache(youtubeId);
  return result;
}

async function deleteDownloadFromInstance(
  instance: YoutarrInstanceConfig,
  youtubeId: string
) {
  const response = await requestYoutarrInstance(instance, "/api/videos", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtubeIds: [youtubeId] }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `Could not delete download (${response.status})`);
  }
  return data;
}

export async function addChannel(url: string) {
  const normalized = url.trim();
  if (!normalized) throw new Error("Channel URL is required");

  const primaryChannel = await addChannelToInstance(primaryInstance, normalized);
  const secondaryInstances = configuredSecondaryPlaybackInstances();
  const secondaryResults = await Promise.allSettled(
    secondaryInstances.map((instance) => addChannelToInstance(instance, normalized))
  );
  const failures = secondaryResults
    .map((result, index) =>
      result.status === "rejected"
        ? `${secondaryInstances[index].label}: ${
            result.reason instanceof Error ? result.reason.message : "unknown error"
          }`
        : ""
    )
    .filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`Channel was not added to every Youtarr instance. ${failures.join("; ")}`);
  }

  return primaryChannel;
}

async function addChannelToInstance(
  instance: YoutarrInstanceConfig,
  normalized: string
) {
  const infoResponse = await requestYoutarrInstance(instance, "/addchannelinfo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: normalized }),
  });
  const infoData = (await infoResponse.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    channelInfo?: YoutarrChannelInfo;
  };
  if (!infoResponse.ok || infoData.status !== "success" || !infoData.channelInfo) {
    throw new Error(
      infoData.message || `Could not add channel (${infoResponse.status})`
    );
  }

  const channelId = infoData.channelInfo.channel_id || infoData.channelInfo.id || "";
  if (!infoData.channelInfo.enabled) {
    const updateResponse = await requestYoutarrInstance(instance, "/updatechannels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        add: [{ url: normalized, channel_id: channelId }],
      }),
    });
    const updateData = (await updateResponse.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
    };
    if (!updateResponse.ok || updateData.status !== "success") {
      throw new Error(
        updateData.message || `Could not save channel (${updateResponse.status})`
      );
    }
  }

  return {
    id: channelId,
    name: infoData.channelInfo.uploader || infoData.channelInfo.title || normalized,
    url: normalized,
    restored: infoData.channelInfo.existing === true,
  };
}

function summarizeActivity(snapshot: YoutarrActivitySnapshot): DownloadActivity {
  const activity = snapshot.activity || snapshot.lastFinalActivity || null;
  const progress = activity?.progress || {};
  const finalSummary = activity?.finalSummary;
  const rawPercent = Number(progress.percent);
  const percent = Number.isFinite(rawPercent)
    ? Math.max(0, Math.min(100, rawPercent))
    : finalSummary
      ? 100
      : 0;
  const state = progress.state || (snapshot.terminal ? "idle" : "active");

  if (!activity || (snapshot.terminal && !finalSummary && state === "idle")) {
    return { state: "idle", label: "No active download", percent: 0 };
  }

  if (finalSummary || state === "complete") {
    const downloaded = finalSummary?.totalDownloaded ?? activity.videoCount?.completed ?? 0;
    const failed = finalSummary?.totalFailed ?? 0;
    return {
      state: failed > 0 ? "error" : "complete",
      label: failed > 0 ? `${failed} mislukt, ${downloaded} klaar` : `${downloaded} video klaar`,
      percent: 100,
      capturedAt: snapshot.capturedAt ?? null,
    };
  }

  const total = activity.videoCount?.total || 0;
  const current = activity.videoCount?.current || 0;
  const label =
    state === "initiating"
      ? "Download voorbereiden"
      : total > 1
        ? `Video ${Math.max(current, 1)} van ${total}`
        : "Download bezig";

  return {
    state: state === "error" ? "error" : "active",
    label,
    percent,
    etaSeconds: progress.etaSeconds,
    speedBytesPerSecond: progress.speedBytesPerSecond,
    capturedAt: snapshot.capturedAt ?? null,
  };
}

export async function getDownloadActivity(): Promise<DownloadActivity> {
  const response = await requestYoutarr("/api/jobs/current-activity");
  if (!response.ok) {
    throw new Error(`Could not load progress (${response.status})`);
  }
  return summarizeActivity((await response.json()) as YoutarrActivitySnapshot);
}

export async function getStream(
  youtubeId: string,
  range?: string | null,
  profile: YoutarrPlaybackProfile = "primary"
) {
  const headers = new Headers();
  if (range) headers.set("Range", range);
  return requestYoutarrInstance(
    playbackInstanceForProfile(profile),
    `/api/videos/${encodeURIComponent(youtubeId)}/stream`,
    { headers }
  );
}

export async function getChannelAvatar(channelId: string) {
  if (!configuredUrl) throw new Error("YOUTARR_URL is missing");
  return fetch(
    `${configuredUrl}/images/channelthumb-${encodeURIComponent(channelId)}.jpg`,
    { cache: "no-store" }
  );
}
