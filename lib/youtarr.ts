import type { Channel, DownloadActivity, FeedVideo } from "./types";

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

const configuredUrl = process.env.YOUTARR_URL?.trim().replace(/\/+$/, "") || "";
const configuredSession = process.env.YOUTARR_SESSION_TOKEN?.trim() || "";
const configuredUser = process.env.YOUTARR_USERNAME?.trim() || "";
const configuredPassword = process.env.YOUTARR_PASSWORD || "";
const configuredApiKey = process.env.YOUTARR_API_KEY?.trim() || "";
const configuredYouTubeApiKey = process.env.YOUTUBE_API_KEY?.trim() || "";
const authDisabled = process.env.YOUTARR_AUTH_DISABLED === "true";

let cachedToken = configuredSession;
let tokenExpiresAt = configuredSession ? Number.POSITIVE_INFINITY : 0;
let youtubeApiBackoffUntil = 0;
const youtubePublishedAtCache = new Map<string, string | null>();

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
    throw new Error(`Youtarr request failed (${response.status})`);
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
  };
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
  options: {
    allowRedownload?: boolean;
    channelId?: string;
  } = {}
) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    throw new Error("Invalid video ID");
  }
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
    response = await requestYoutarr("/triggerspecificdownloads", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } else if (configuredApiKey) {
    headers.set("x-api-key", configuredApiKey);
    response = await fetch(`${configuredUrl}/api/videos/download`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } else {
    response = await requestYoutarr("/api/videos/download", {
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
    throw new Error(data.error || `Could not start download (${response.status})`);
  }
  return data;
}

export async function deleteDownload(youtubeId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
    throw new Error("Invalid video ID");
  }
  const response = await requestYoutarr("/api/videos", {
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

  const infoResponse = await requestYoutarr("/addchannelinfo", {
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
    throw new Error(infoData.message || `Could not add channel (${infoResponse.status})`);
  }
  if (infoData.channelInfo.enabled) {
    throw new Error("This channel is already in Youtarr");
  }

  const channelId = infoData.channelInfo.channel_id || infoData.channelInfo.id || "";
  const updateResponse = await requestYoutarr("/updatechannels", {
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
    throw new Error(updateData.message || `Could not save channel (${updateResponse.status})`);
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

export async function getStream(youtubeId: string, range?: string | null) {
  const headers = new Headers();
  if (range) headers.set("Range", range);
  return requestYoutarr(
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
