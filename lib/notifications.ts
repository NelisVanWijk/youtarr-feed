import { readFile } from "node:fs/promises";
import webpush from "web-push";
import type { PushSubscription, WebPushError } from "web-push";
import { appDataPath, writeJsonAtomic } from "./app-data";
import type { FeedVideo } from "./types";

type StoredPushSubscription = PushSubscription & {
  createdAt: number;
  updatedAt: number;
  userAgent?: string;
  failureCount?: number;
};

type PushStore = {
  version: 1;
  subscriptions: StoredPushSubscription[];
};

type VapidStore = {
  version: 1;
  publicKey: string;
  privateKey: string;
};

type NotificationState = {
  version: 1;
  seenVideoIds: string[];
  lastScanAt: number;
  lastNotifiedAt?: number;
};

type NotificationPayload = {
  title: string;
  body: string;
  icon: string;
  badge: string;
  image?: string;
  tag: string;
  url: string;
  videoId: string;
  badgeCount?: number;
};

type PushSendResult = {
  attempted: number;
  sent: number;
  removed: number;
  failed: number;
  subscriberCount: number;
  errors: string[];
};

export class PushDeliveryError extends Error {
  result: PushSendResult;

  constructor(message: string, result: PushSendResult) {
    super(message);
    this.name = "PushDeliveryError";
    this.result = result;
  }
}

const pushStorePath = appDataPath("push-subscriptions.json");
const vapidStorePath = appDataPath("push-vapid.json");
const notificationStatePath = appDataPath("notification-state.json");
const notificationsEnabled =
  (process.env.YOUTARR_FEED_NOTIFICATIONS_ENABLED?.trim().toLowerCase() ||
    "true") !== "false";
const notificationMaxPerScan = Math.max(
  1,
  Number(process.env.YOUTARR_FEED_NOTIFICATION_MAX_PER_SCAN) || 5
);

function normalizeVapidSubject(value: string | undefined) {
  const subject = value?.trim();
  if (!subject || /\blocalhost\b/i.test(subject)) {
    return "mailto:youtarr-feed@example.com";
  }
  return subject;
}

const vapidSubject = normalizeVapidSubject(
  process.env.YOUTARR_FEED_PUSH_SUBJECT
);

let vapidKeysPromise: Promise<VapidStore> | null = null;
let vapidConfigured = false;
let pushWriteQueue: Promise<unknown> = Promise.resolve();
let stateWriteQueue: Promise<unknown> = Promise.resolve();

function isValidSubscription(value: unknown): value is PushSubscription {
  const subscription = value as Partial<PushSubscription> | null;
  return Boolean(
    subscription &&
      typeof subscription.endpoint === "string" &&
      subscription.endpoint.startsWith("https://") &&
      typeof subscription.keys?.p256dh === "string" &&
      typeof subscription.keys.auth === "string"
  );
}

function normalizeStore(value: unknown): PushStore {
  const store = value as Partial<PushStore> | null;
  if (store?.version !== 1 || !Array.isArray(store.subscriptions)) {
    return { version: 1, subscriptions: [] };
  }
  return {
    version: 1,
    subscriptions: store.subscriptions.filter(isValidSubscription).map((item) => ({
      ...item,
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
      userAgent: typeof item.userAgent === "string" ? item.userAgent : undefined,
      failureCount: Number(item.failureCount) || 0,
    })),
  };
}

function normalizeNotificationState(value: unknown): NotificationState {
  const state = value as Partial<NotificationState> | null;
  if (state?.version !== 1 || !Array.isArray(state.seenVideoIds)) {
    return { version: 1, seenVideoIds: [], lastScanAt: 0 };
  }
  return {
    version: 1,
    seenVideoIds: [
      ...new Set(
        state.seenVideoIds.filter((id): id is string => typeof id === "string")
      ),
    ],
    lastScanAt: Number(state.lastScanAt) || 0,
    lastNotifiedAt: Number(state.lastNotifiedAt) || undefined,
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function readPushStore() {
  return normalizeStore(await readJsonFile(pushStorePath, null));
}

async function writePushStore(store: PushStore) {
  await writeJsonAtomic(pushStorePath, store);
}

async function readNotificationState() {
  return normalizeNotificationState(
    await readJsonFile(notificationStatePath, null)
  );
}

async function writeNotificationState(state: NotificationState) {
  await writeJsonAtomic(notificationStatePath, state);
}

async function getVapidKeys() {
  if (!vapidKeysPromise) {
    vapidKeysPromise = (async () => {
      const envPublicKey = process.env.YOUTARR_FEED_VAPID_PUBLIC_KEY?.trim();
      const envPrivateKey = process.env.YOUTARR_FEED_VAPID_PRIVATE_KEY?.trim();
      if (envPublicKey && envPrivateKey) {
        return {
          version: 1 as const,
          publicKey: envPublicKey,
          privateKey: envPrivateKey,
        };
      }

      const stored = await readJsonFile<Partial<VapidStore> | null>(
        vapidStorePath,
        null
      );
      if (stored?.version === 1 && stored.publicKey && stored.privateKey) {
        return {
          version: 1 as const,
          publicKey: stored.publicKey,
          privateKey: stored.privateKey,
        };
      }

      const generated = webpush.generateVAPIDKeys();
      const next = { version: 1 as const, ...generated };
      await writeJsonAtomic(vapidStorePath, next);
      return next;
    })();
  }
  return vapidKeysPromise;
}

async function configureVapid() {
  const keys = await getVapidKeys();
  if (!vapidConfigured) {
    webpush.setVapidDetails(vapidSubject, keys.publicKey, keys.privateKey);
    vapidConfigured = true;
  }
  return keys;
}

function notificationUrl(video: FeedVideo) {
  return `/?watch=${encodeURIComponent(video.id)}`;
}

function notificationPayload(video: FeedVideo, badgeCount: number): NotificationPayload {
  return {
    title: video.channelName || "Youtarr Feed",
    body: video.title,
    icon: "/icon-512.png",
    badge: "/apple-touch-icon.png",
    image: video.thumbnail || undefined,
    tag: `new-video-${video.id}`,
    url: notificationUrl(video),
    videoId: video.id,
    badgeCount,
  };
}

function isExpiredSubscription(error: unknown) {
  const statusCode = (error as WebPushError | undefined)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

function describePushError(error: unknown) {
  const pushError = error as WebPushError | undefined;
  const statusCode = pushError?.statusCode;
  const body = pushError?.body?.trim();
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Push delivery failed";
  const detail = body ? `${message}: ${body}` : message;
  return statusCode ? `${statusCode}: ${detail}` : detail;
}

async function sendPayloadToSubscriptions(payload: NotificationPayload) {
  if (!notificationsEnabled) {
    return {
      attempted: 0,
      sent: 0,
      removed: 0,
      failed: 0,
      subscriberCount: 0,
      errors: [],
    };
  }
  await configureVapid();
  const store = await readPushStore();
  if (store.subscriptions.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      removed: 0,
      failed: 0,
      subscriberCount: 0,
      errors: [],
    };
  }

  let sent = 0;
  let removed = 0;
  let failed = 0;
  const errors = new Set<string>();
  const survivors: StoredPushSubscription[] = [];
  await Promise.all(
    store.subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 * 7, urgency: "normal" }
        );
        sent += 1;
        survivors.push({ ...subscription, failureCount: 0 });
      } catch (error) {
        if (isExpiredSubscription(error)) {
          removed += 1;
          return;
        }
        failed += 1;
        errors.add(describePushError(error));
        const failureCount = (subscription.failureCount || 0) + 1;
        if (failureCount >= 3) {
          removed += 1;
          return;
        }
        survivors.push({ ...subscription, failureCount });
      }
    })
  );

  await writePushStore({ version: 1, subscriptions: survivors });
  return {
    attempted: store.subscriptions.length,
    sent,
    removed,
    failed,
    subscriberCount: survivors.length,
    errors: [...errors].slice(0, 3),
  };
}

export async function getPushPublicConfig() {
  if (!notificationsEnabled) {
    return {
      enabled: false,
      publicKey: null,
      subscriberCount: 0,
    };
  }
  const [keys, store] = await Promise.all([getVapidKeys(), readPushStore()]);
  return {
    enabled: true,
    publicKey: keys.publicKey,
    subscriberCount: store.subscriptions.length,
  };
}

export async function savePushSubscription(
  subscription: unknown,
  userAgent?: string | null
) {
  if (!notificationsEnabled) {
    throw new Error("Notifications are disabled");
  }
  if (!isValidSubscription(subscription)) {
    throw new Error("Invalid push subscription");
  }
  await configureVapid();
  const now = Date.now();
  const result = pushWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const store = await readPushStore();
      const existing = store.subscriptions.find(
        (item) => item.endpoint === subscription.endpoint
      );
      const nextSubscription: StoredPushSubscription = {
        ...subscription,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        userAgent: userAgent || existing?.userAgent,
        failureCount: 0,
      };
      const subscriptions = [
        nextSubscription,
        ...store.subscriptions.filter(
          (item) => item.endpoint !== subscription.endpoint
        ),
      ];
      await writePushStore({ version: 1, subscriptions });
      return subscriptions.length;
    });
  pushWriteQueue = result;
  return result;
}

export async function removePushSubscription(endpoint: unknown) {
  if (typeof endpoint !== "string" || !endpoint) return 0;
  const result = pushWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const store = await readPushStore();
      const subscriptions = store.subscriptions.filter(
        (subscription) => subscription.endpoint !== endpoint
      );
      await writePushStore({ version: 1, subscriptions });
      return subscriptions.length;
    });
  pushWriteQueue = result;
  return result;
}

export async function sendTestPushNotification(subscription?: unknown) {
  if (subscription && isValidSubscription(subscription)) {
    await savePushSubscription(subscription);
  }
  const result = await sendPayloadToSubscriptions({
    title: "Youtarr Feed",
    body: "Notifications are ready for new videos.",
    icon: "/icon-512.png",
    badge: "/apple-touch-icon.png",
    tag: `youtarr-feed-test-${Date.now()}`,
    url: "/",
    videoId: "test",
    badgeCount: 1,
  });
  if (result.sent > 0) return result;

  const message =
    result.attempted === 0
      ? "No push subscriptions are saved for this browser."
      : result.removed > 0
        ? "The saved push subscription expired. Disable notifications, enable them again, and retry."
        : result.failed > 0
          ? `The push service rejected the test notification${
              result.errors[0] ? ` (${result.errors[0]})` : ""
            }. Disable notifications, enable them again, and retry.`
          : "The test notification was not accepted by the push service.";
  throw new PushDeliveryError(message, result);
}

export async function notifyNewFeedVideos(videos: FeedVideo[]) {
  if (!notificationsEnabled || videos.length === 0) return;
  const result = stateWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const state = await readNotificationState();
      const seen = new Set(state.seenVideoIds);
      const currentVideoIds = [
        ...new Set(videos.map((video) => video.id).filter(Boolean)),
      ];
      if (state.lastScanAt === 0 || seen.size === 0) {
        await writeNotificationState({
          version: 1,
          seenVideoIds: currentVideoIds,
          lastScanAt: Date.now(),
        });
        return;
      }

      const newVideos = videos
        .filter((video) => !seen.has(video.id))
        .sort((left, right) => {
          const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
          const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
          return rightTime - leftTime;
        });
      const now = Date.now();
      await writeNotificationState({
        version: 1,
        seenVideoIds: currentVideoIds,
        lastScanAt: now,
        lastNotifiedAt: newVideos.length > 0 ? now : state.lastNotifiedAt,
      });

      await Promise.all(
        newVideos
          .slice(0, notificationMaxPerScan)
          .map((video) =>
            sendPayloadToSubscriptions(
              notificationPayload(video, Math.min(newVideos.length, 99))
            )
          )
      );
    });
  stateWriteQueue = result;
  await result;
}
