import { readFile } from "node:fs/promises";
import { appDataPath, removeAppDataFile, writeJsonAtomic } from "./app-data";
import type {
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

type FloatplaneSubscription = {
  creator?: string;
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

type FloatplaneSession = {
  cookie: string;
  savedAt: number;
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
  Math.min(160, Number(process.env.FLOATPLANE_FEED_LIMIT) || 80)
);
const floatplanePerCreatorLimit = Math.max(
  3,
  Math.min(20, Number(process.env.FLOATPLANE_PER_CREATOR_LIMIT) || 12)
);
const floatplaneMaxHeight = Math.max(
  0,
  Number(process.env.FLOATPLANE_MAX_HEIGHT) || 0
);
const floatplanePreferredCodec =
  process.env.FLOATPLANE_PREFERRED_CODEC?.trim().toLowerCase() || "avc1";
const sessionPath = appDataPath("floatplane-session.json");
const userAgent = "YoutarrFeed/0.1.0 CFNetwork/1496 Darwin/23.0.0";

let memorySession: FloatplaneSession | null = null;
let loginBackoffUntil = 0;

export function isFloatplaneConfigured() {
  return Boolean(
    floatplaneEnabled &&
      (floatplaneSessionToken || (floatplaneUsername && floatplanePassword))
  );
}

function secretState(value: string) {
  return value ? "Set" : "Not set";
}

function sessionCookieFromEnv() {
  if (!floatplaneSessionToken) return "";
  return floatplaneSessionToken.includes("=")
    ? floatplaneSessionToken
    : `sails.sid=${floatplaneSessionToken}`;
}

async function readStoredSession() {
  if (memorySession) return memorySession;
  try {
    const parsed = JSON.parse(await readFile(sessionPath, "utf8")) as Partial<FloatplaneSession>;
    if (!parsed.cookie || typeof parsed.cookie !== "string") return null;
    memorySession = {
      cookie: parsed.cookie,
      savedAt: Number(parsed.savedAt) || Date.now(),
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

async function writeSession(cookie: string) {
  memorySession = { cookie, savedAt: Date.now() };
  await writeJsonAtomic(sessionPath, memorySession);
}

async function clearSession() {
  memorySession = null;
  await removeAppDataFile(sessionPath);
}

async function login() {
  const envCookie = sessionCookieFromEnv();
  if (envCookie) return envCookie;

  const stored = await readStoredSession();
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
  if (!isFloatplaneConfigured()) {
    throw new Error("Floatplane is not configured");
  }
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

  if (response.status === 401 && retry && !floatplaneSessionToken) {
    await clearSession();
    return requestFloatplane(path, init, false);
  }
  return response;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await requestFloatplane(path);
  if (!response.ok) {
    throw new Error(`Floatplane request failed (${response.status})`);
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

function videoIdFromAttachment(attachment: string | FloatplaneVideo | undefined) {
  return typeof attachment === "string" ? attachment : attachment?.id || attachment?.guid || "";
}

function namespacedVideoId(videoId: string) {
  return `floatplane:${videoId}`;
}

function rawVideoId(videoId: string) {
  return videoId.startsWith("floatplane:") ? videoId.slice("floatplane:".length) : videoId;
}

function toFeedVideo(post: FloatplanePost): FeedVideo | null {
  if (post.isAccessible === false || post.metadata?.hasVideo === false) return null;
  const attachment = post.videoAttachments?.[0];
  const videoId = videoIdFromAttachment(attachment);
  const postId = post.id || post.guid || "";
  if (!videoId || !postId) return null;
  const creator = creatorFromPost(post);
  const attachmentObject = typeof attachment === "object" ? attachment : null;
  return {
    id: namespacedVideoId(videoId),
    provider: "floatplane",
    channelId: `floatplane:${creator.id || "creator"}`,
    channelName: creator.title || "Floatplane",
    channelAvatar: imagePath(creator.icon),
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

export async function getFloatplaneFeed(): Promise<{
  channels: [];
  videos: FeedVideo[];
  warnings: string[];
}> {
  const subscriptions = await getJson<FloatplaneSubscription[]>(
    "/api/v3/user/subscriptions"
  );
  const creatorIds = [
    ...new Set(subscriptions.map((subscription) => subscription.creator).filter(Boolean)),
  ] as string[];
  const warnings: string[] = [];
  const results = await Promise.allSettled(
    creatorIds.map((creatorId) => {
      const url = new URL("/api/v3/content/creator", floatplaneBaseUrl);
      url.searchParams.set("id", creatorId);
      url.searchParams.set("limit", String(floatplanePerCreatorLimit));
      url.searchParams.set("hasVideo", "true");
      url.searchParams.set("sort", "DESC");
      return getJson<FloatplanePost[]>(`${url.pathname}${url.search}`);
    })
  );

  const videos = results.flatMap((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${creatorIds[index]} could not be loaded`);
      return [];
    }
    return result.value.map(toFeedVideo).filter((video): video is FeedVideo => video !== null);
  });

  videos.sort(
    (left, right) =>
      new Date(right.publishedAt || 0).getTime() -
      new Date(left.publishedAt || 0).getTime()
  );
  return { channels: [], videos: videos.slice(0, floatplaneFeedLimit), warnings };
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

function variantUrl(group: FloatplaneDeliveryGroup, variant: FloatplaneDeliveryVariant) {
  if (!variant.url) return "";
  if (/^https?:\/\//i.test(variant.url)) return variant.url;
  const origin =
    variant.origins?.find((item) => item.url)?.url ||
    group.origins?.find((item) => item.url)?.url ||
    floatplaneBaseUrl;
  return new URL(variant.url, origin).toString();
}

function selectVariant(groups: FloatplaneDeliveryGroup[]) {
  const variants = groups.flatMap((group) =>
    (group.variants || []).map((variant) => ({ group, variant }))
  );
  const candidates = variants
    .filter(({ variant }) => variant.url && variant.enabled !== false && !variant.hidden)
    .filter(({ variant }) => !floatplaneMaxHeight || variantHeight(variant) <= floatplaneMaxHeight)
    .filter(({ variant }) => {
      const mimeType = (variant.mimeType || "").toLowerCase();
      const name = (variant.name || "").toLowerCase();
      return mimeType.includes("mpegurl") || name.includes("hls");
    });
  const sorted = [...(candidates.length ? candidates : variants)].sort((left, right) => {
    const leftPreferred = variantCodec(left.variant).includes(floatplanePreferredCodec) ? 1 : 0;
    const rightPreferred = variantCodec(right.variant).includes(floatplanePreferredCodec) ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    return variantHeight(right.variant) - variantHeight(left.variant);
  });
  return sorted[0] || null;
}

export async function getFloatplaneStreamUrl(videoId: string) {
  const rawId = rawVideoId(videoId);
  const delivery = await getJson<{ groups?: FloatplaneDeliveryGroup[] }>(
    `/api/v3/delivery/info?scenario=onDemand&outputKind=hls.fmp4&entityId=${encodeURIComponent(rawId)}`
  );
  const selected = selectVariant(delivery.groups || []);
  if (!selected) throw new Error("No playable Floatplane stream was returned");
  const url = variantUrl(selected.group, selected.variant);
  if (!url) throw new Error("No playable Floatplane stream URL was returned");
  return {
    url,
    label: selected.variant.label || selected.variant.name || "Floatplane",
    codec: variantCodec(selected.variant) || null,
    height: variantHeight(selected.variant) || null,
  };
}

async function checkFloatplaneConnection(): Promise<ConnectionStatus> {
  if (!floatplaneEnabled) return { ok: false, message: "Disabled" };
  if (!isFloatplaneConfigured()) {
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
      label: "Session token",
      value: secretState(floatplaneSessionToken),
      secret: true,
    },
    {
      key: "FLOATPLANE_PREFERRED_CODEC",
      label: "Preferred codec",
      value: floatplanePreferredCodec,
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
    configured: isFloatplaneConfigured(),
    connection: options.checkConnection
      ? await checkFloatplaneConnection()
      : {
          ok: isFloatplaneConfigured(),
          message: isFloatplaneConfigured() ? "Not checked" : "Not configured",
        },
    settings,
  };
}
