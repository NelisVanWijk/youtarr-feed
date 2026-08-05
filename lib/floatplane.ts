import { readFile } from "node:fs/promises";
import { appDataPath, removeAppDataFile, writeJsonAtomic } from "./app-data";
import type {
  Channel as AppChannel,
  ConnectionStatus,
  FeedVideo,
  ServiceDiagnostic,
  SettingValue,
} from "./types";

type FloatplaneImage = {
  width?: number;
  height?: number;
  path?: string | null;
  childImages?: FloatplaneImage[] | null;
};

type FloatplaneCreator = {
  id?: string;
  title?: string;
  urlname?: string;
  icon?: FloatplaneImage | null;
  card?: FloatplaneImage | null;
};

type FloatplaneChannel = {
  id?: string;
  creator?: string;
  title?: string;
  urlname?: string;
  icon?: FloatplaneImage | null;
  card?: FloatplaneImage | null;
};

type FloatplaneSubscription = {
  creator?: string;
};

type FloatplaneCreatorListResponse = {
  blogPosts?: FloatplanePost[];
  lastElements?: Array<{
    creatorId?: string;
    blogPostId?: string | null;
    moreFetchable?: boolean;
  }>;
};

type FloatplanePost = {
  id?: string;
  guid?: string;
  title?: string;
  text?: string;
  releaseDate?: string | null;
  likes?: number;
  dislikes?: number;
  score?: number;
  creator?: FloatplaneCreator | string;
  channel?: FloatplaneChannel | string;
  thumbnail?: FloatplaneImage | null;
  isAccessible?: boolean;
  metadata?: {
    hasVideo?: boolean;
    videoDuration?: number;
  };
  videoAttachments?: Array<string | FloatplaneVideo>;
};

type FloatplaneVideo = {
  id?: string;
  guid?: string;
  title?: string;
  description?: string;
  releaseDate?: string | null;
  duration?: number;
  creator?: string;
  likes?: number;
  dislikes?: number;
  score?: number;
  primaryBlogPost?: string;
  thumbnail?: FloatplaneImage | null;
  isAccessible?: boolean;
};

type FloatplaneDeliveryVariant = {
  name?: string;
  label?: string;
  url?: string;
  enabled?: boolean;
  hidden?: boolean;
  mimeType?: string;
  origins?: Array<{ url?: string }>;
  order?: number;
  meta?: {
    video?: {
      codec?: string;
      codecSimple?: string;
      height?: number;
      width?: number;
    };
  };
};

type FloatplaneDeliveryGroup = {
  origins?: Array<{ url?: string }>;
  variants?: FloatplaneDeliveryVariant[];
};

type FloatplaneVariantChoice = {
  group: FloatplaneDeliveryGroup;
  variant: FloatplaneDeliveryVariant;
};

type FloatplaneVariantSummary = {
  name: string;
  label: string;
  codec: string | null;
  height: number | null;
  mimeType: string | null;
  enabled: boolean;
  hidden: boolean;
};

type FloatplaneSessionSource = "login" | "manual";

type FloatplaneSession = {
  cookie: string;
  savedAt: number;
  source?: FloatplaneSessionSource;
};

type FloatplanePlaybackMode = "mp4" | "hls";

type FloatplaneStreamInfo = {
  url: string;
  label: string;
  codec: string | null;
  height: number | null;
  mimeType: string | null;
  playbackMode: FloatplanePlaybackMode;
  available: FloatplaneVariantSummary[];
};

const floatplaneBaseUrl = "https://www.floatplane.com";
const floatplaneEnabled =
  (process.env.FLOATPLANE_ENABLED?.trim().toLowerCase() || "false") === "true";
const floatplaneUsername = process.env.FLOATPLANE_USERNAME?.trim() || "";
const floatplanePassword = process.env.FLOATPLANE_PASSWORD || "";
const floatplaneTotp = process.env.FLOATPLANE_TOTP?.trim() || "";
const floatplaneSessionToken = process.env.FLOATPLANE_SESSION_TOKEN?.trim() || "";
const floatplaneFeedLimit = Math.max(
  5,
  Math.min(1000, Number(process.env.FLOATPLANE_FEED_LIMIT) || 500)
);
const floatplaneFetchLimit = Math.max(
  20,
  Math.min(
    1000,
    Number(process.env.FLOATPLANE_FETCH_LIMIT) ||
      Math.max(floatplaneFeedLimit * 2, 500)
  )
);
const floatplanePerChannelLimit = Math.max(
  1,
  Math.min(20, Number(process.env.FLOATPLANE_PER_CHANNEL_LIMIT) || 20)
);
const floatplaneMaxHeight = Math.max(
  0,
  Number(process.env.FLOATPLANE_MAX_HEIGHT) || 0
);
const floatplanePreferredCodec =
  process.env.FLOATPLANE_PREFERRED_CODEC?.trim().toLowerCase() || "h264";
const rawFloatplanePlaybackMode =
  process.env.FLOATPLANE_PLAYBACK_MODE?.trim().toLowerCase() || "mp4";
const floatplanePlaybackMode: FloatplanePlaybackMode =
  rawFloatplanePlaybackMode === "hls" ? "hls" : "mp4";
const floatplaneOutputKind =
  process.env.FLOATPLANE_OUTPUT_KIND?.trim().toLowerCase() || "hls.mpegts";
const floatplaneStreamCacheTtlMs =
  Math.max(
    30,
    Math.min(3600, Number(process.env.FLOATPLANE_STREAM_CACHE_TTL_SECONDS) || 600)
  ) * 1000;
const sessionPath = appDataPath("floatplane-session.json");
const userAgent = "YoutarrFeed/0.1.0 CFNetwork/1496 Darwin/23.0.0";

let memorySession: FloatplaneSession | null = null;
let loginBackoffUntil = 0;
const streamCache = new Map<
  string,
  { expiresAt: number; stream: FloatplaneStreamInfo }
>();

export async function isFloatplaneConfigured() {
  const stored = await readStoredSession();
  return Boolean(
    floatplaneEnabled &&
      (stored?.cookie ||
        floatplaneSessionToken ||
        (floatplaneUsername && floatplanePassword))
  );
}

function secretState(value: string) {
  return value ? "Set" : "Not set";
}

function normalizeSessionCookie(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Floatplane session token is required");
  }
  const cookie = trimmed.includes("=") ? trimmed : `sails.sid=${trimmed}`;
  if (!/(^|;\s*)sails\.sid=[^;]+/.test(cookie)) {
    throw new Error("Floatplane session token must include a sails.sid value");
  }
  return cookie;
}

function sessionCookieFromEnv() {
  if (!floatplaneSessionToken) return "";
  return normalizeSessionCookie(floatplaneSessionToken);
}

async function readStoredSession() {
  if (memorySession) return memorySession;
  try {
    const parsed = JSON.parse(await readFile(sessionPath, "utf8")) as Partial<FloatplaneSession>;
    if (!parsed.cookie || typeof parsed.cookie !== "string") return null;
    memorySession = {
      cookie: parsed.cookie,
      savedAt: Number(parsed.savedAt) || Date.now(),
      source: parsed.source === "manual" ? "manual" : "login",
    };
    return memorySession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function cookieFromResponse(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    headers.getSetCookie?.() ||
    response.headers.get("set-cookie")?.split(/,(?=[^;,]+=)/) ||
    [];
  return setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function writeSession(cookie: string, source: FloatplaneSessionSource = "login") {
  memorySession = { cookie, savedAt: Date.now(), source };
  await writeJsonAtomic(sessionPath, memorySession);
}

async function clearSession() {
  memorySession = null;
  await removeAppDataFile(sessionPath);
}

export async function saveFloatplaneSessionToken(token: string) {
  if (!floatplaneEnabled) {
    throw new Error("Floatplane is disabled; set FLOATPLANE_ENABLED=true first");
  }
  const cookie = normalizeSessionCookie(token);
  await writeSession(cookie, "manual");
  streamCache.clear();
}

async function login() {
  const stored = await readStoredSession();
  if (stored?.source === "manual" && stored.cookie) return stored.cookie;

  const envCookie = sessionCookieFromEnv();
  if (envCookie) return envCookie;

  if (stored?.cookie) return stored.cookie;
  if (Date.now() < loginBackoffUntil) {
    const seconds = Math.max(1, Math.ceil((loginBackoffUntil - Date.now()) / 1000));
    throw new Error(
      `Floatplane login is rate limited; try again in ${seconds} seconds or set FLOATPLANE_SESSION_TOKEN`
    );
  }
  if (!floatplaneUsername || !floatplanePassword) {
    throw new Error("Floatplane credentials are not configured");
  }

  const response = await fetch(`${floatplaneBaseUrl}/api/v3/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": userAgent,
    },
    body: JSON.stringify({
      username: floatplaneUsername,
      password: floatplanePassword,
    }),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as {
    needs2FA?: boolean;
  };
  let cookie = cookieFromResponse(response);
  if (response.ok && data.needs2FA) {
    if (!floatplaneTotp) {
      throw new Error("Floatplane requires 2FA; set FLOATPLANE_TOTP or use FLOATPLANE_SESSION_TOKEN");
    }
    const twoFactorResponse = await fetch(
      `${floatplaneBaseUrl}/api/v3/auth/checkFor2faLogin`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": userAgent,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ token: floatplaneTotp }),
        cache: "no-store",
      }
    );
    if (!twoFactorResponse.ok) {
      throw new Error(`Floatplane 2FA login failed (${twoFactorResponse.status})`);
    }
    cookie = cookieFromResponse(twoFactorResponse) || cookie;
  } else if (!response.ok) {
    if (response.status === 429) {
      loginBackoffUntil = Date.now() + 10 * 60 * 1000;
      throw new Error(
        "Floatplane login is rate limited (429); wait before retrying or set FLOATPLANE_SESSION_TOKEN"
      );
    }
    throw new Error(`Floatplane login failed (${response.status})`);
  }

  if (!cookie) throw new Error("Floatplane login did not return a session cookie");
  await writeSession(cookie);
  return cookie;
}

async function requestFloatplane(path: string, init: RequestInit = {}, retry = true) {
  if (!floatplaneEnabled) {
    throw new Error("Floatplane is disabled");
  }
  const stored = await readStoredSession();
  const usingManualSession = stored?.source === "manual" && Boolean(stored.cookie);
  const cookie = await login();
  const response = await fetch(`${floatplaneBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
      Cookie: cookie,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  if (
    response.status === 401 &&
    retry &&
    !floatplaneSessionToken &&
    !usingManualSession
  ) {
    await clearSession();
    return requestFloatplane(path, init, false);
  }
  return response;
}

function floatplaneRequestError(status: number) {
  if (status === 401 || status === 403) {
    return `Floatplane session token expired or invalid (${status}); paste a fresh sails.sid in Settings`;
  }
  if (status === 429) {
    return "Floatplane is rate limiting login or API requests (429); wait before retrying";
  }
  return `Floatplane request failed (${status})`;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await requestFloatplane(path);
  if (!response.ok) {
    throw new Error(floatplaneRequestError(response.status));
  }
  return (await response.json()) as T;
}

function imagePath(image?: FloatplaneImage | null) {
  if (!image) return "";
  const children = image.childImages || [];
  return (
    [...children].sort((left, right) => (right.width || 0) - (left.width || 0))[0]
      ?.path ||
    image.path ||
    ""
  );
}

function stripHtml(value?: string | null) {
  return (value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function creatorFromPost(post: FloatplanePost): FloatplaneCreator {
  return typeof post.creator === "object" && post.creator ? post.creator : {};
}

function channelFromPost(
  post: FloatplanePost,
  channelMap: Map<string, FloatplaneChannel> = new Map()
): FloatplaneChannel | null {
  if (typeof post.channel === "string") {
    return channelMap.get(post.channel) || null;
  }
  return typeof post.channel === "object" && post.channel ? post.channel : null;
}

function videoIdFromAttachment(attachment: string | FloatplaneVideo | undefined) {
  return typeof attachment === "string" ? attachment : attachment?.id || attachment?.guid || "";
}

function namespacedVideoId(videoId: string) {
  return `floatplane:${videoId}`;
}

function rawVideoId(videoId: string) {
  return videoId.startsWith("floatplane:") ? videoId.slice("floatplane:".length) : videoId;
}

function rawChannelId(channelId: string) {
  return channelId.startsWith("floatplane:")
    ? channelId.slice("floatplane:".length)
    : channelId;
}

function toFeedVideo(
  post: FloatplanePost,
  channelMap: Map<string, FloatplaneChannel> = new Map()
): FeedVideo | null {
  if (post.isAccessible === false || post.metadata?.hasVideo === false) return null;
  const attachment = post.videoAttachments?.[0];
  const videoId = videoIdFromAttachment(attachment);
  const postId = post.id || post.guid || "";
  if (!videoId || !postId) return null;
  const creator = creatorFromPost(post);
  const channel = channelFromPost(post, channelMap);
  const channelId = channel?.id || creator.id || "creator";
  const channelName = channel?.title || creator.title || "Floatplane";
  const channelAvatar =
    imagePath(channel?.icon) || imagePath(channel?.card) || imagePath(creator.icon);
  const attachmentObject = typeof attachment === "object" ? attachment : null;
  return {
    id: namespacedVideoId(videoId),
    provider: "floatplane",
    channelId: `floatplane:${channelId}`,
    channelName,
    channelAvatar,
    title: post.title || attachmentObject?.title || "Untitled Floatplane video",
    thumbnail: imagePath(post.thumbnail) || imagePath(attachmentObject?.thumbnail) || imagePath(creator.card),
    publishedAt: post.releaseDate || attachmentObject?.releaseDate || null,
    duration: Number(post.metadata?.videoDuration || attachmentObject?.duration) || 0,
    downloaded: true,
    missing: false,
    watched: false,
    sourceLabel: "Floatplane",
    description: stripHtml(post.text || attachmentObject?.description || ""),
    webpageUrl: `https://www.floatplane.com/post/${postId}`,
  };
}

function toAppChannel(channel: FloatplaneChannel): AppChannel | null {
  if (!channel.id || !channel.title) return null;
  return {
    id: `floatplane:${channel.id}`,
    name: channel.title,
    url: channel.urlname
      ? `https://www.floatplane.com/channel/${channel.urlname}`
      : `https://www.floatplane.com/channel/${channel.id}`,
    avatar: imagePath(channel.icon) || imagePath(channel.card),
    autoDownload: false,
  };
}

function appChannelFromVideo(video: FeedVideo): AppChannel {
  return {
    id: video.channelId,
    name: video.channelName,
    url: video.webpageUrl || "",
    avatar: video.channelAvatar,
    autoDownload: false,
  };
}

function postChannelId(post: FloatplanePost) {
  if (typeof post.channel === "string") return post.channel;
  return post.channel?.id || "";
}

function uniquePosts(posts: FloatplanePost[]) {
  return [
    ...new Map(
      posts.map((post) => [post.id || post.guid || JSON.stringify(post), post])
    ).values(),
  ];
}

function uniqueVideos(videos: FeedVideo[]) {
  return [...new Map(videos.map((video) => [video.id, video])).values()];
}

function buildFloatplaneUrl(pathname: string) {
  return new URL(pathname, floatplaneBaseUrl);
}

async function getFloatplaneChannels(creatorIds: string[]) {
  if (!creatorIds.length) return [];
  const url = buildFloatplaneUrl("/api/v3/creator/channels/list");
  creatorIds.forEach((creatorId) => url.searchParams.append("ids", creatorId));
  return getJson<FloatplaneChannel[]>(`${url.pathname}${url.search}`);
}

async function getSubscribedFloatplaneContext(warnings: string[]) {
  const subscriptions = await getJson<FloatplaneSubscription[]>(
    "/api/v3/user/subscriptions"
  );
  const creatorIds = [
    ...new Set(subscriptions.map((subscription) => subscription.creator).filter(Boolean)),
  ] as string[];
  const channels = await getFloatplaneChannels(creatorIds).catch((error) => {
    warnings.push(
      error instanceof Error
        ? `Floatplane channels could not be loaded: ${error.message}`
        : "Floatplane channels could not be loaded"
    );
    return [];
  });
  const channelMap = new Map(
    channels
      .filter((channel) => channel.id)
      .map((channel) => [channel.id as string, channel])
  );
  return { creatorIds, channels, channelMap };
}

async function getFloatplanePostsForCreators(creatorIds: string[]) {
  if (!creatorIds.length) return [];
  const url = buildFloatplaneUrl("/api/v3/content/creator/list");
  creatorIds.forEach((creatorId) => url.searchParams.append("ids", creatorId));
  url.searchParams.set("limit", String(floatplaneFetchLimit));
  const response = await getJson<FloatplaneCreatorListResponse>(
    `${url.pathname}${url.search}`
  );
  return response.blogPosts || [];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function getFloatplanePostsByChannel(
  creatorIds: string[],
  channels: FloatplaneChannel[]
) {
  const channelTargets = channels
    .filter((channel) => channel.id && channel.creator)
    .map((channel) => ({
      creatorId: channel.creator as string,
      channelId: channel.id as string,
    }));
  const creatorsWithChannels = new Set(channelTargets.map((target) => target.creatorId));
  const creatorTargets = creatorIds
    .filter((creatorId) => !creatorsWithChannels.has(creatorId))
    .map((creatorId) => ({ creatorId, channelId: "" }));
  const targets = [...channelTargets, ...creatorTargets];
  const batches = await mapWithConcurrency(targets, 6, async (target) => {
    const url = buildFloatplaneUrl("/api/v3/content/creator");
    url.searchParams.set("id", target.creatorId);
    if (target.channelId) url.searchParams.set("channel", target.channelId);
    url.searchParams.set("limit", String(floatplanePerChannelLimit));
    url.searchParams.set("hasVideo", "true");
    url.searchParams.set("sort", "DESC");
    return getJson<FloatplanePost[]>(`${url.pathname}${url.search}`);
  });
  return batches.flat();
}

export async function getFloatplaneFeed(): Promise<{
  channels: AppChannel[];
  videos: FeedVideo[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const { creatorIds, channels, channelMap } =
    await getSubscribedFloatplaneContext(warnings);

  let posts = await getFloatplanePostsForCreators(creatorIds).catch((error) => {
    warnings.push(
      error instanceof Error
        ? `Floatplane multi-creator feed failed: ${error.message}`
        : "Floatplane multi-creator feed failed"
    );
    return [];
  });

  const loadedChannelIds = new Set(
    posts.map(postChannelId).filter((channelId) => channelId)
  );
  const missingChannels = channels.filter(
    (channel) => channel.id && !loadedChannelIds.has(channel.id)
  );

  if (posts.length < Math.min(floatplaneFeedLimit, 120) || missingChannels.length) {
    const channelPosts = await getFloatplanePostsByChannel(
      creatorIds,
      posts.length < Math.min(floatplaneFeedLimit, 120) ? channels : missingChannels
    ).catch((error) => {
      warnings.push(
        error instanceof Error
          ? `Floatplane channel feed fallback failed: ${error.message}`
          : "Floatplane channel feed fallback failed"
      );
      return [];
    });
    posts = uniquePosts([...posts, ...channelPosts]);
  }

  const videos = uniqueVideos(
    posts
      .map((post) => toFeedVideo(post, channelMap))
      .filter((video): video is FeedVideo => video !== null)
  );

  videos.sort(
    (left, right) =>
      new Date(right.publishedAt || 0).getTime() -
      new Date(left.publishedAt || 0).getTime()
  );
  const channelList = [
    ...new Map(
      [
        ...channels
          .map(toAppChannel)
          .filter((channel): channel is AppChannel => channel !== null),
        ...videos.map(appChannelFromVideo),
      ].map((channel) => [channel.id, channel])
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
  return {
    channels: channelList,
    videos: videos.slice(0, floatplaneFeedLimit),
    warnings,
  };
}

export async function getFloatplaneChannelFeedPage(
  channelId: string,
  offset: number,
  limit: number
): Promise<{
  channels: AppChannel[];
  videos: FeedVideo[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const { creatorIds, channels, channelMap } =
    await getSubscribedFloatplaneContext(warnings);
  const rawId = rawChannelId(channelId);
  const targetChannel = channels.find((channel) => channel.id === rawId);
  const creatorId =
    targetChannel?.creator || creatorIds.find((id) => id === rawId) || "";
  const channelList = [
    ...new Map(
      channels
        .map(toAppChannel)
        .filter((channel): channel is AppChannel => channel !== null)
        .map((channel) => [channel.id, channel])
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));

  if (!creatorId) {
    return {
      channels: channelList,
      videos: [],
      warnings: [
        ...warnings,
        `Floatplane channel ${channelId} is not available in the current subscriptions.`,
      ],
    };
  }

  const posts: FloatplanePost[] = [];
  const targetCount = Math.max(1, limit);
  let fetchOffset = Math.max(0, offset);
  while (posts.length < targetCount) {
    const batchLimit = Math.min(
      floatplanePerChannelLimit,
      targetCount - posts.length
    );
    const url = buildFloatplaneUrl("/api/v3/content/creator");
    url.searchParams.set("id", creatorId);
    if (targetChannel?.id) url.searchParams.set("channel", targetChannel.id);
    url.searchParams.set("limit", String(batchLimit));
    if (fetchOffset > 0) url.searchParams.set("fetchAfter", String(fetchOffset));
    url.searchParams.set("hasVideo", "true");
    url.searchParams.set("sort", "DESC");
    const batch = await getJson<FloatplanePost[]>(`${url.pathname}${url.search}`);
    if (batch.length === 0) break;
    posts.push(...batch);
    fetchOffset += batch.length;
    if (batch.length < batchLimit) break;
  }

  const videos = uniqueVideos(
    posts
      .map((post) => toFeedVideo(post, channelMap))
      .filter((video): video is FeedVideo => video !== null)
  );
  videos.sort(
    (left, right) =>
      new Date(right.publishedAt || 0).getTime() -
      new Date(left.publishedAt || 0).getTime()
  );

  return {
    channels: channelList,
    videos,
    warnings,
  };
}

export async function getFloatplaneVideoMetadata(videoId: string) {
  const rawId = rawVideoId(videoId);
  const video = await getJson<FloatplaneVideo>(
    `/api/v3/content/video?id=${encodeURIComponent(rawId)}`
  );
  return {
    description: stripHtml(video.description || ""),
    likeCount:
      typeof video.likes === "number" && Number.isFinite(video.likes)
        ? video.likes
        : null,
    webpageUrl: video.primaryBlogPost
      ? `https://www.floatplane.com/post/${video.primaryBlogPost}`
      : null,
  };
}

function variantHeight(variant: FloatplaneDeliveryVariant) {
  const metaHeight = Number(variant.meta?.video?.height) || 0;
  const labelHeight = Number(String(variant.label || variant.name || "").match(/(\d{3,4})/)?.[1]) || 0;
  return metaHeight || labelHeight;
}

function variantCodec(variant: FloatplaneDeliveryVariant) {
  return (
    variant.meta?.video?.codecSimple ||
    variant.meta?.video?.codec ||
    variant.name ||
    ""
  ).toLowerCase();
}

function variantSummary(variant: FloatplaneDeliveryVariant): FloatplaneVariantSummary {
  return {
    name: variant.name || "",
    label: variant.label || "",
    codec: variantCodec(variant) || null,
    height: variantHeight(variant) || null,
    mimeType: variant.mimeType || null,
    enabled: variant.enabled !== false,
    hidden: variant.hidden === true,
  };
}

function codecMatchesPreference(codec: string) {
  if (!floatplanePreferredCodec) return false;
  if (floatplanePreferredCodec === "h264") {
    return codec.includes("h264") || codec.includes("avc1");
  }
  if (floatplanePreferredCodec === "avc1") {
    return codec.includes("avc1") || codec.includes("h264");
  }
  return codec.includes(floatplanePreferredCodec);
}

function variantUrl(group: FloatplaneDeliveryGroup, variant: FloatplaneDeliveryVariant) {
  if (!variant.url) return "";
  if (/^https?:\/\//i.test(variant.url)) return variant.url;
  const origin =
    variant.origins?.find((item) => item.url)?.url ||
    group.origins?.find((item) => item.url)?.url ||
    floatplaneBaseUrl;
  return new URL(variant.url, origin).toString();
}

function selectVariant(groups: FloatplaneDeliveryGroup[]): {
  selected: FloatplaneVariantChoice;
  available: FloatplaneVariantSummary[];
} {
  const variants = groups.flatMap((group) =>
    (group.variants || []).map((variant) => ({ group, variant }))
  );
  const available = variants.map(({ variant }) => variantSummary(variant));
  const candidates = variants
    .filter(({ variant }) => variant.url && variant.enabled !== false && !variant.hidden)
    .filter(({ variant }) => !floatplaneMaxHeight || variantHeight(variant) <= floatplaneMaxHeight)
    .filter(({ variant }) => {
      const mimeType = (variant.mimeType || "").toLowerCase();
      const name = (variant.name || "").toLowerCase();
      if (floatplanePlaybackMode === "hls") {
        return mimeType.includes("mpegurl") || name.includes("hls");
      }
      return mimeType.includes("video/mp4") || /\.mp4(?:\?|$)/i.test(variant.url || "");
    });

  const playable = candidates.length ? candidates : variants;
  const preferred = playable.filter(({ variant }) =>
    codecMatchesPreference(variantCodec(variant))
  );

  const sorted = [...(preferred.length ? preferred : playable)].sort((left, right) => {
    const leftPreferred = codecMatchesPreference(variantCodec(left.variant)) ? 1 : 0;
    const rightPreferred = codecMatchesPreference(variantCodec(right.variant)) ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    return variantHeight(right.variant) - variantHeight(left.variant);
  });
  const selected = sorted[0];
  if (!selected) throw new Error("No playable Floatplane stream was returned");
  return { selected, available };
}

function streamCacheKey(rawId: string) {
  return [
    rawId,
    floatplanePlaybackMode,
    floatplaneOutputKind,
    floatplanePreferredCodec,
    String(floatplaneMaxHeight),
  ].join(":");
}

export async function getFloatplaneStreamUrl(
  videoId: string,
  options: { refresh?: boolean } = {}
): Promise<FloatplaneStreamInfo> {
  const rawId = rawVideoId(videoId);
  const cacheKey = streamCacheKey(rawId);
  const cached = streamCache.get(cacheKey);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.stream;
  }

  const params = new URLSearchParams({
    scenario: floatplanePlaybackMode === "hls" ? "onDemand" : "download",
    entityId: rawId,
  });
  if (floatplanePlaybackMode === "hls") {
    params.set("outputKind", floatplaneOutputKind);
  }
  const delivery = await getJson<{ groups?: FloatplaneDeliveryGroup[] }>(
    `/api/v3/delivery/info?${params.toString()}`
  );
  const { selected, available } = selectVariant(delivery.groups || []);
  const url = variantUrl(selected.group, selected.variant);
  if (!url) throw new Error("No playable Floatplane stream URL was returned");
  const stream = {
    url,
    label: selected.variant.label || selected.variant.name || "Floatplane",
    codec: variantCodec(selected.variant) || null,
    height: variantHeight(selected.variant) || null,
    mimeType: selected.variant.mimeType || null,
    playbackMode: floatplanePlaybackMode,
    available,
  };
  streamCache.set(cacheKey, {
    expiresAt: Date.now() + floatplaneStreamCacheTtlMs,
    stream,
  });
  return stream;
}

async function checkFloatplaneConnection(): Promise<ConnectionStatus> {
  if (!floatplaneEnabled) return { ok: false, message: "Disabled" };
  if (!(await isFloatplaneConfigured())) {
    return { ok: false, message: "Authentication is not configured" };
  }
  try {
    const subscriptions = await getJson<FloatplaneSubscription[]>(
      "/api/v3/user/subscriptions"
    );
    return {
      ok: true,
      status: 200,
      message: `${subscriptions.length} subscriptions`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

export async function getFloatplaneDiagnostics(
  options: { checkConnection?: boolean } = {}
): Promise<ServiceDiagnostic> {
  const configured = await isFloatplaneConfigured();
  const stored = await readStoredSession();
  const settings: SettingValue[] = [
    {
      key: "FLOATPLANE_ENABLED",
      label: "Enabled",
      value: floatplaneEnabled ? "true" : "false",
    },
    {
      key: "FLOATPLANE_USERNAME",
      label: "Username",
      value: secretState(floatplaneUsername),
      secret: true,
    },
    {
      key: "FLOATPLANE_PASSWORD",
      label: "Password",
      value: secretState(floatplanePassword),
      secret: true,
    },
    {
      key: "FLOATPLANE_TOTP",
      label: "2FA token",
      value: secretState(floatplaneTotp),
      secret: true,
    },
    {
      key: "FLOATPLANE_SESSION_TOKEN",
      label: "Env session token",
      value: secretState(floatplaneSessionToken),
      secret: true,
    },
    {
      key: "FLOATPLANE_STORED_SESSION",
      label: "Stored session",
      value: stored?.cookie ? `Set (${stored.source || "login"})` : "Not set",
      secret: true,
    },
    {
      key: "FLOATPLANE_FEED_LIMIT",
      label: "Feed limit",
      value: String(floatplaneFeedLimit),
    },
    {
      key: "FLOATPLANE_FETCH_LIMIT",
      label: "Fetch limit",
      value: String(floatplaneFetchLimit),
    },
    {
      key: "FLOATPLANE_PER_CHANNEL_LIMIT",
      label: "Per channel fallback",
      value: String(floatplanePerChannelLimit),
    },
    {
      key: "FLOATPLANE_PREFERRED_CODEC",
      label: "Preferred codec",
      value: floatplanePreferredCodec,
    },
    {
      key: "FLOATPLANE_PLAYBACK_MODE",
      label: "Playback mode",
      value: floatplanePlaybackMode,
    },
    {
      key: "FLOATPLANE_STREAM_CACHE_TTL_SECONDS",
      label: "Stream URL cache",
      value: String(Math.round(floatplaneStreamCacheTtlMs / 1000)),
    },
    {
      key: "FLOATPLANE_OUTPUT_KIND",
      label: "Output kind",
      value: floatplaneOutputKind,
    },
    {
      key: "FLOATPLANE_MAX_HEIGHT",
      label: "Max height",
      value: floatplaneMaxHeight ? String(floatplaneMaxHeight) : "Unlimited",
    },
  ];

  return {
    key: "floatplane",
    label: "Floatplane",
    configured,
    connection: options.checkConnection
      ? await checkFloatplaneConnection()
      : {
          ok: configured,
          message: configured ? "Not checked" : "Not configured",
        },
    settings,
  };
}
