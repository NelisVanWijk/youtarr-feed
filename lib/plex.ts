import type { ServiceDiagnostic, SettingValue, WatchProgressMap } from "./types";

const plexUrl = process.env.PLEX_URL?.trim().replace(/\/+$/, "") || "";
const plexToken = process.env.PLEX_TOKEN?.trim() || "";
const plexLibraryId = process.env.PLEX_LIBRARY_ID?.trim() || "";
const plexWatchSyncEnabled =
  (process.env.PLEX_WATCH_SYNC_ENABLED?.trim().toLowerCase() || "true") !==
  "false";

const plexIdentifier = "com.plexapp.plugins.library";
const plexMatchCacheTtlMs = 30 * 60 * 1000;
const plexMatchMissTtlMs = 60 * 1000;
const plexProgressSyncMinIntervalMs = 30 * 1000;
const plexProgressSyncMinDeltaSeconds = 30;

type PlexPart = {
  file?: string;
};

type PlexMedia = {
  Part?: PlexPart[];
};

type PlexMetadata = {
  ratingKey?: string;
  key?: string;
  title?: string;
  duration?: number;
  viewOffset?: number;
  viewCount?: number;
  Media?: PlexMedia[];
};

type PlexLibraryResponse = {
  MediaContainer?: {
    Metadata?: PlexMetadata[];
    totalSize?: number;
    size?: number;
  };
};

type PlexImportedProgress =
  | {
      videoId: string;
      watched: true;
    }
  | {
      videoId: string;
      watched: false;
      entry: WatchProgressMap[string];
    };

const plexRatingKeyCache = new Map<
  string,
  { ratingKey: string | null; expiresAt: number }
>();
const plexProgressSyncCache = new Map<
  string,
  { currentTime: number; syncedAt: number; watched: boolean }
>();

const youtubeIdPattern = /(?:\[|[-_\s])([A-Za-z0-9_-]{11})(?:\]|\.|$)/;

export function isPlexConfigured() {
  return Boolean(plexUrl && plexToken && /^\d+$/.test(plexLibraryId));
}

export function isPlexWatchSyncConfigured() {
  return isPlexConfigured() && plexWatchSyncEnabled;
}

export function getPlexPublicConfig() {
  return {
    configured: isPlexConfigured(),
    watchSyncConfigured: isPlexWatchSyncConfigured(),
    server: plexUrl
      ? plexUrl.replace(/^https?:\/\//, "").split("/")[0]
      : undefined,
  };
}

function plexApiUrl(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(path, plexUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  url.searchParams.set("X-Plex-Token", plexToken);
  return url;
}

async function requestPlex(
  path: string,
  params: Record<string, string | number> = {},
  init: RequestInit = {}
) {
  if (!isPlexConfigured()) {
    throw new Error("Plex-koppeling is niet compleet");
  }
  return fetch(plexApiUrl(path, params), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

export async function refreshPlexLibrary() {
  if (!isPlexConfigured()) {
    throw new Error("Plex-koppeling is niet compleet");
  }

  const response = await requestPlex(
    `/library/sections/${encodeURIComponent(plexLibraryId)}/refresh`
  );

  if (!response.ok) {
    throw new Error(`Plex library scan failed (${response.status})`);
  }
}

function isValidYoutubeId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function plexFileMatchesVideoId(file: string | undefined, videoId: string) {
  if (!file) return false;
  return file.includes(`[${videoId}]`) || file.includes(`-${videoId}`) || file.includes(videoId);
}

function youtubeIdFromPlexFile(file: string | undefined) {
  if (!file) return null;
  return file.match(youtubeIdPattern)?.[1] || null;
}

function ratingKeyFromMetadata(metadata: PlexMetadata, videoId: string) {
  const matched = (metadata.Media || []).some((media) =>
    (media.Part || []).some((part) => plexFileMatchesVideoId(part.file, videoId))
  );
  if (!matched) return null;
  return metadata.ratingKey || metadata.key?.split("/").pop() || null;
}

async function findPlexRatingKey(videoId: string) {
  const cached = plexRatingKeyCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.ratingKey;

  const pageSize = 500;
  const maxPages = 20;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await requestPlex(
      `/library/sections/${encodeURIComponent(plexLibraryId)}/all`,
      {
        includeGuids: 1,
        "X-Plex-Container-Start": page * pageSize,
        "X-Plex-Container-Size": pageSize,
      }
    );
    if (!response.ok) {
      throw new Error(`Plex library lookup failed (${response.status})`);
    }

    const data = (await response.json()) as PlexLibraryResponse;
    const container = data.MediaContainer;
    const metadata = container?.Metadata || [];
    const match = metadata
      .map((item) => ratingKeyFromMetadata(item, videoId))
      .find((ratingKey): ratingKey is string => Boolean(ratingKey));
    if (match) {
      plexRatingKeyCache.set(videoId, {
        ratingKey: match,
        expiresAt: Date.now() + plexMatchCacheTtlMs,
      });
      return match;
    }

    const totalSize = Number(container?.totalSize) || metadata.length;
    if ((page + 1) * pageSize >= totalSize || metadata.length === 0) break;
  }

  plexRatingKeyCache.set(videoId, {
    ratingKey: null,
    expiresAt: Date.now() + plexMatchMissTtlMs,
  });
  return null;
}

function shouldSyncPlexProgress(
  videoId: string,
  currentTime: number,
  watched: boolean
) {
  const previous = plexProgressSyncCache.get(videoId);
  if (!previous) return true;
  if (watched && !previous.watched) return true;
  if (watched && previous.watched) return false;
  return (
    Date.now() - previous.syncedAt >= plexProgressSyncMinIntervalMs ||
    Math.abs(currentTime - previous.currentTime) >= plexProgressSyncMinDeltaSeconds
  );
}

export async function syncPlexWatchProgress(entry: {
  videoId?: string;
  currentTime?: number;
  duration?: number;
}) {
  if (!isPlexWatchSyncConfigured()) return;

  const videoId = entry.videoId?.trim() || "";
  const currentTime = Number(entry.currentTime);
  const duration = Number(entry.duration);
  if (
    !isValidYoutubeId(videoId) ||
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    currentTime < 5
  ) {
    return;
  }

  const watched = currentTime > duration - 8;
  if (!shouldSyncPlexProgress(videoId, currentTime, watched)) return;

  const ratingKey = await findPlexRatingKey(videoId);
  if (!ratingKey) return;

  const response = watched
    ? await requestPlex("/:/scrobble", {
        identifier: plexIdentifier,
        key: ratingKey,
      })
    : await requestPlex("/:/progress", {
        identifier: plexIdentifier,
        key: ratingKey,
        time: Math.round(currentTime * 1000),
        state: "stopped",
      });
  if (!response.ok) {
    throw new Error(`Plex watch progress sync failed (${response.status})`);
  }

  plexProgressSyncCache.set(videoId, {
    currentTime,
    syncedAt: Date.now(),
    watched,
  });
}

function progressFromPlexMetadata(
  metadata: PlexMetadata
): PlexImportedProgress | null {
  const videoId = (metadata.Media || [])
    .flatMap((media) => media.Part || [])
    .map((part) => youtubeIdFromPlexFile(part.file))
    .find((id): id is string => Boolean(id));
  if (!videoId) return null;

  const duration = Number(metadata.duration) / 1000;
  const currentTime = Number(metadata.viewOffset) / 1000;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (metadata.viewCount && metadata.viewCount > 0) return { videoId, watched: true };
  if (!Number.isFinite(currentTime) || currentTime < 5) return null;
  if (currentTime > duration - 8) {
    return { videoId, watched: true };
  }

  return {
    videoId,
    watched: false,
    entry: {
      videoId,
      currentTime,
      duration,
      updatedAt: Date.now(),
    },
  };
}

export async function importPlexWatchProgress() {
  if (!isPlexWatchSyncConfigured()) {
    return { progress: {}, watchedVideoIds: [] };
  }

  const imported = new Map<string, PlexImportedProgress>();
  const pageSize = 500;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await requestPlex(
      `/library/sections/${encodeURIComponent(plexLibraryId)}/all`,
      {
        includeGuids: 1,
        "X-Plex-Container-Start": page * pageSize,
        "X-Plex-Container-Size": pageSize,
      }
    );
    if (!response.ok) {
      throw new Error(`Plex watch progress import failed (${response.status})`);
    }

    const data = (await response.json()) as PlexLibraryResponse;
    const container = data.MediaContainer;
    const metadata = container?.Metadata || [];
    metadata
      .map(progressFromPlexMetadata)
      .filter((item): item is PlexImportedProgress => Boolean(item))
      .forEach((item) => imported.set(item.videoId, item));

    const totalSize = Number(container?.totalSize) || metadata.length;
    if ((page + 1) * pageSize >= totalSize || metadata.length === 0) break;
  }

  return {
    progress: Object.fromEntries(
      [...imported.values()]
        .filter((item) => !item.watched)
        .map((item) => [item.videoId, item.entry])
    ),
    watchedVideoIds: [...imported.values()]
      .filter((item) => item.watched)
      .map((item) => item.videoId),
  };
}

function secretState(value: string) {
  return value ? "Set" : "Not set";
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function checkPlexConnection() {
  if (!plexUrl) return { ok: false, message: "URL is not set" };
  if (!plexToken) return { ok: false, message: "Token is not set" };
  if (!/^\d+$/.test(plexLibraryId)) {
    return { ok: false, message: "Library ID is not set" };
  }

  const timeout = timeoutSignal(8000);
  try {
    const response = await fetch(
      `${plexUrl}/library/sections/${encodeURIComponent(plexLibraryId)}`,
      {
        headers: {
          Accept: "application/json",
          "X-Plex-Token": plexToken,
        },
        cache: "no-store",
        signal: timeout.signal,
      }
    );
    return response.ok
      ? { ok: true, status: response.status, message: "Connected" }
      : {
          ok: false,
          status: response.status,
          message: `Connection failed (${response.status})`,
        };
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

export async function getPlexDiagnostics(): Promise<ServiceDiagnostic> {
  const settings: SettingValue[] = [
    { key: "PLEX_URL", label: "URL", value: plexUrl || "Not set" },
    {
      key: "PLEX_TOKEN",
      label: "Token",
      value: secretState(plexToken),
      secret: true,
    },
    {
      key: "PLEX_LIBRARY_ID",
      label: "Library ID",
      value: plexLibraryId || "Not set",
    },
    {
      key: "PLEX_WATCH_SYNC_ENABLED",
      label: "Watch sync",
      value: plexWatchSyncEnabled ? "Enabled" : "Disabled",
    },
  ];

  return {
    key: "plex",
    label: "Plex",
    configured: isPlexConfigured(),
    connection: await checkPlexConnection(),
    settings,
  };
}
