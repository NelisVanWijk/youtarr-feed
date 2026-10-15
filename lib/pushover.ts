import { readFile } from "node:fs/promises";
import { appDataPath, removeAppDataFile, writeJsonAtomic } from "./app-data";

type PushoverSettings = {
  version: 1;
  enabled: boolean;
  applicationToken: string;
  userKey: string;
  device: string;
  appUrl: string;
  includeImage: boolean;
  updatedAt: number;
};

export type PushoverPublicConfig = {
  configured: boolean;
  enabled: boolean;
  applicationTokenSet: boolean;
  userKeySet: boolean;
  device: string;
  appUrl: string;
  includeImage: boolean;
  updatedAt: number | null;
};

type PushoverSettingsInput = {
  enabled?: unknown;
  applicationToken?: unknown;
  userKey?: unknown;
  device?: unknown;
  appUrl?: unknown;
  includeImage?: unknown;
};

type PushoverApiResponse = {
  status?: number;
  request?: string;
  errors?: string[];
};

type PushoverMessage = {
  title: string;
  message: string;
  url?: string;
  urlTitle?: string;
  imageUrl?: string;
};

const settingsPath = appDataPath("pushover-settings.json");
const pushoverMessagesUrl = "https://api.pushover.net/1/messages.json";
const maxAttachmentBytes = 5_242_880;
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/gif"]);
let settingsWriteQueue: Promise<unknown> = Promise.resolve();

function defaultSettings(): PushoverSettings {
  return {
    version: 1,
    enabled: false,
    applicationToken: "",
    userKey: "",
    device: "",
    appUrl: "",
    includeImage: true,
    updatedAt: 0,
  };
}

function normalizeSettings(value: unknown): PushoverSettings {
  const candidate = value as Partial<PushoverSettings> | null;
  if (candidate?.version !== 1) return defaultSettings();
  return {
    version: 1,
    enabled: candidate.enabled === true,
    applicationToken:
      typeof candidate.applicationToken === "string"
        ? candidate.applicationToken.trim()
        : "",
    userKey:
      typeof candidate.userKey === "string" ? candidate.userKey.trim() : "",
    device: typeof candidate.device === "string" ? candidate.device.trim() : "",
    appUrl: typeof candidate.appUrl === "string" ? candidate.appUrl.trim() : "",
    includeImage: candidate.includeImage !== false,
    updatedAt: Number(candidate.updatedAt) || 0,
  };
}

async function readSettings() {
  try {
    return normalizeSettings(JSON.parse(await readFile(settingsPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultSettings();
    }
    throw error;
  }
}

function isCredential(value: string) {
  return /^[A-Za-z0-9]{30}$/.test(value);
}

function normalizeDevice(value: unknown) {
  if (typeof value !== "string") return undefined;
  const device = value.trim();
  if (!device) return "";
  const names = device.split(",");
  if (
    names.some(
      (name) => !name || name.length > 25 || !/^[A-Za-z0-9_-]+$/.test(name)
    )
  ) {
    throw new Error("Pushover device names may only contain letters, numbers, _ and -");
  }
  return names.join(",");
}

function normalizeAppUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid Youtarr Feed URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The Youtarr Feed URL must use HTTP or HTTPS");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function publicConfig(settings: PushoverSettings): PushoverPublicConfig {
  const configured =
    isCredential(settings.applicationToken) && isCredential(settings.userKey);
  return {
    configured,
    enabled: configured && settings.enabled,
    applicationTokenSet: isCredential(settings.applicationToken),
    userKeySet: isCredential(settings.userKey),
    device: settings.device,
    appUrl: settings.appUrl,
    includeImage: settings.includeImage,
    updatedAt: settings.updatedAt || null,
  };
}

export async function getPushoverConfig() {
  return publicConfig(await readSettings());
}

export async function savePushoverConfig(input: PushoverSettingsInput) {
  const result = settingsWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readSettings();
      const applicationToken =
        typeof input.applicationToken === "string" &&
        input.applicationToken.trim()
          ? input.applicationToken.trim()
          : current.applicationToken;
      const userKey =
        typeof input.userKey === "string" && input.userKey.trim()
          ? input.userKey.trim()
          : current.userKey;
      if (applicationToken && !isCredential(applicationToken)) {
        throw new Error("Pushover application tokens contain exactly 30 letters or numbers");
      }
      if (userKey && !isCredential(userKey)) {
        throw new Error("Pushover user or group keys contain exactly 30 letters or numbers");
      }

      const next: PushoverSettings = {
        version: 1,
        enabled:
          typeof input.enabled === "boolean" ? input.enabled : current.enabled,
        applicationToken,
        userKey,
        device: normalizeDevice(input.device) ?? current.device,
        appUrl: normalizeAppUrl(input.appUrl) ?? current.appUrl,
        includeImage:
          typeof input.includeImage === "boolean"
            ? input.includeImage
            : current.includeImage,
        updatedAt: Date.now(),
      };
      if (next.enabled && (!applicationToken || !userKey)) {
        throw new Error("Enter both a Pushover application token and user/group key");
      }
      await writeJsonAtomic(settingsPath, next);
      return publicConfig(next);
    });
  settingsWriteQueue = result;
  return result;
}

export async function clearPushoverConfig() {
  const result = settingsWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await removeAppDataFile(settingsPath);
      return publicConfig(defaultSettings());
    });
  settingsWriteQueue = result;
  return result;
}

function truncateUtf8(value: string, maximumBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maximumBytes) return value;
  let result = "";
  for (const character of value) {
    if (encoder.encode(result + character).byteLength > maximumBytes) break;
    result += character;
  }
  return result;
}

function messageUrl(settings: PushoverSettings, path: string) {
  if (!settings.appUrl) return undefined;
  try {
    return new URL(path, `${settings.appUrl}/`).toString();
  } catch {
    return undefined;
  }
}

async function fetchImage(imageUrl: string, appUrl: string) {
  let url: URL;
  try {
    url = new URL(imageUrl, appUrl || undefined);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "i.ytimg.com" && url.hostname !== "img.youtube.com")
  ) {
    return null;
  }

  const response = await fetch(url, {
    headers: { Accept: "image/*", "User-Agent": "YoutarrFeed/0.1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const declaredLength = Number(response.headers.get("content-length")) || 0;
  if (declaredLength > maxAttachmentBytes) return null;
  const contentType = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!supportedImageTypes.has(contentType)) return null;
  const data = await response.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > maxAttachmentBytes) return null;
  return { data, contentType };
}

function imageFilename(contentType: string) {
  if (contentType === "image/png") return "thumbnail.png";
  if (contentType === "image/gif") return "thumbnail.gif";
  return "thumbnail.jpg";
}

async function sendMessage(settings: PushoverSettings, message: PushoverMessage) {
  if (!isCredential(settings.applicationToken) || !isCredential(settings.userKey)) {
    throw new Error("Pushover is not configured");
  }

  const form = new FormData();
  form.set("token", settings.applicationToken);
  form.set("user", settings.userKey);
  form.set("title", truncateUtf8(message.title, 250));
  form.set("message", truncateUtf8(message.message, 1024));
  if (settings.device) form.set("device", settings.device);
  if (message.url) {
    form.set("url", truncateUtf8(message.url, 512));
    form.set("url_title", truncateUtf8(message.urlTitle || "Open video", 100));
  }

  if (settings.includeImage && message.imageUrl) {
    try {
      const image = await fetchImage(message.imageUrl, settings.appUrl);
      if (image) {
        form.set(
          "attachment",
          new Blob([image.data], { type: image.contentType }),
          imageFilename(image.contentType)
        );
      }
    } catch {
      // A notification is still useful when its remote thumbnail is unavailable.
    }
  }

  const response = await fetch(pushoverMessagesUrl, {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as PushoverApiResponse;
  if (!response.ok || data.status !== 1) {
    const detail = data.errors?.filter(Boolean).join("; ");
    throw new Error(
      detail
        ? `Pushover rejected the notification: ${detail}`
        : `Pushover rejected the notification (${response.status})`
    );
  }
  const remainingHeader = response.headers.get("x-limit-app-remaining");
  const remaining = remainingHeader === null ? null : Number(remainingHeader);
  return {
    success: true,
    request: data.request || null,
    remaining: Number.isFinite(remaining) ? remaining : null,
  };
}

export async function sendTestPushoverNotification() {
  const settings = await readSettings();
  return sendMessage(settings, {
    title: "Youtarr Feed",
    message: "Pushover notifications are ready for new videos.",
    url: settings.appUrl || undefined,
    urlTitle: "Open Youtarr Feed",
  });
}

export async function sendPushoverVideoNotification(input: {
  videoId: string;
  videoTitle: string;
  channelName?: string;
  imageUrl?: string;
}) {
  const settings = await readSettings();
  if (!settings.enabled) return { success: false, skipped: true };
  return sendMessage(settings, {
    title: input.channelName || "New video",
    message: input.videoTitle,
    url: messageUrl(settings, `/?watch=${encodeURIComponent(input.videoId)}`),
    urlTitle: "Watch video",
    imageUrl: input.imageUrl,
  });
}
