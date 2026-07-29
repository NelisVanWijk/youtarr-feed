import type { Channel, FeedVideo } from "./types";

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
};

const configuredUrl = process.env.YOUTARR_URL?.trim().replace(/\/+$/, "") || "";
const configuredSession = process.env.YOUTARR_SESSION_TOKEN?.trim() || "";
const configuredUser = process.env.YOUTARR_USERNAME?.trim() || "";
const configuredPassword = process.env.YOUTARR_PASSWORD || "";
const configuredApiKey = process.env.YOUTARR_API_KEY?.trim() || "";
const authDisabled = process.env.YOUTARR_AUTH_DISABLED === "true";

let cachedToken = configuredSession;
let tokenExpiresAt = configuredSession ? Number.POSITIVE_INFINITY : 0;

export function isYoutarrConfigured() {
  return Boolean(
    configuredUrl &&
      (authDisabled || configuredSession || (configuredUser && configuredPassword))
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

async function login() {
  if (authDisabled) return "";
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
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
        ? "Youtarr heeft de inloggegevens geweigerd"
        : `Youtarr-inloggen mislukte (${response.status})`
    );
  }

  const data = (await response.json()) as { token?: string; expires?: string };
  if (!data.token) throw new Error("Youtarr gaf geen sessie terug");
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
  if (!configuredUrl) throw new Error("YOUTARR_URL ontbreekt");
  const token = await login();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-access-token", token);
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

async function getJson<T>(path: string): Promise<T> {
  const response = await requestYoutarr(path);
  if (!response.ok) {
    throw new Error(`Youtarr-aanvraag mislukte (${response.status})`);
  }
  return (await response.json()) as T;
}

function toChannel(channel: YoutarrChannel): Channel {
  const id = channel.channel_id || "";
  return {
    id,
    name: channel.uploader || "Naamloos kanaal",
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
  return {
    id,
    channelId: channel.id,
    channelName: channel.name,
    channelAvatar: channel.avatar,
    title: video.title || "Video zonder titel",
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
  };
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
  const data = await getJson<{ videos?: YoutarrVideo[] }>(
    `/getchannelvideos/${encodeURIComponent(channel.id)}?page=${page}&pageSize=${pageSize}&tabType=videos&sortBy=date&sortOrder=desc&downloadedFilter=off`
  );
  return (data.videos || [])
    .map((video) => toVideo(video, channel))
    .filter((video): video is FeedVideo => video !== null);
}

export async function getFeed(): Promise<{
  channels: Channel[];
  videos: FeedVideo[];
  warnings: string[];
}> {
  const channels = await getChannels();
  const videos: FeedVideo[] = [];
  const warnings: string[] = [];
  const batchSize = 4;

  for (let index = 0; index < channels.length; index += batchSize) {
    const batch = channels.slice(index, index + batchSize);
    const results = await Promise.allSettled(
      batch.map((channel) => fetchChannelVideos(channel))
    );
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        videos.push(...result.value);
      } else {
        warnings.push(`${batch[resultIndex].name} kon niet worden bijgewerkt`);
      }
    });
  }

  videos.sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bTime - aTime;
  });

  return { channels, videos: videos.slice(0, 160), warnings };
}

export async function getVideosForChannel(channelId: string, page = 1) {
  const channels = await getChannels();
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) throw new Error("Kanaal niet gevonden");
  const videos = await fetchChannelVideos(channel, page, 36);
  return { channel, videos };
}

export async function queueDownload(youtubeId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    throw new Error("Ongeldig video-ID");
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  let response: Response;
  if (configuredApiKey) {
    headers.set("x-api-key", configuredApiKey);
    response = await fetch(`${configuredUrl}/api/videos/download`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
      }),
      cache: "no-store",
    });
  } else {
    response = await requestYoutarr("/api/videos/download", {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
      }),
    });
  }
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Download starten mislukte (${response.status})`);
  }
  return data;
}

export async function getStream(youtubeId: string, range?: string | null) {
  const headers = new Headers();
  if (range) headers.set("Range", range);
  return requestYoutarr(
    `/api/videos/${encodeURIComponent(youtubeId)}/stream`,
    { headers }
  );
}

export async function getChannelAvatar(channelId: string) {
  if (!configuredUrl) throw new Error("YOUTARR_URL ontbreekt");
  return fetch(
    `${configuredUrl}/images/channelthumb-${encodeURIComponent(channelId)}.jpg`,
    { cache: "no-store" }
  );
}
