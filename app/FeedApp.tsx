"use client";

import {
  faCheck,
  faChevronLeft,
  faChevronRight,
  faCirclePlay,
  faClockRotateLeft,
  faClone,
  faDownload,
  faEllipsisVertical,
  faExpand,
  faFolderOpen,
  faHouse,
  faInbox,
  faLink,
  faList,
  faMagnifyingGlass,
  faMinus,
  faMobileScreenButton,
  faPause,
  faPlay,
  faPlane,
  faRotateRight,
  faThumbsUp,
  faTrash,
  faUpRightFromSquare,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type Hls from "hls.js";
import {
  defaultLanguage,
  isLanguage,
  languageOptions,
  translations,
} from "../lib/i18n";
import type { AppCopy, Language } from "../lib/i18n";
import type {
  AppMode,
  Channel,
  DownloadActivity,
  FeedResponse,
  FeedStatus,
  FeedVideo,
  ServiceDiagnostic,
  WatchProgressEntry,
  WatchProgressMap,
} from "../lib/types";

type View = "feed" | "continue" | "local" | "singles" | "channels" | "floatplane";
type Filter = "all" | "new" | "downloaded";
type PlayerMode = "full" | "mini";
type WebKitVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: "fullscreen" | "inline" | "picture-in-picture") => void;
  webkitSupportsPresentationMode?: (mode: "picture-in-picture") => boolean;
};
type StreamSourceInfo = {
  source: "local" | "youtarr" | "floatplane";
  playbackProfile?: "primary" | "av1" | "vp9";
  playbackLabel?: string;
  local?: {
    configured: boolean;
    available: boolean;
    fileName?: string;
    extension?: string;
    size?: number;
    playable?: boolean;
    debug?: {
      reason?: string;
      expectedFilePath?: string | null;
      mediaDirectory?: string;
      sourceMediaDirectory?: string;
      checkedPaths?: string[];
    };
  };
  youtarrConfigured: boolean;
  stream?: {
    url?: string;
    label?: string;
    codec?: string | null;
    height?: number | null;
    mimeType?: string | null;
    playbackMode?: string;
  };
};
type FloatplaneFeedPage = FeedResponse & {
  hasMore?: boolean;
  nextOffset?: number | null;
  totalVideos?: number;
  error?: string;
};
type VideoMetadataInfo = {
  description?: string | null;
  likeCount?: number | null;
  webpageUrl?: string | null;
};
type PlayerDragState = {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
};
type DownloadJob = {
  state: "queueing" | "queued" | "error";
  channelId: string;
  error?: string;
};

const palette = ["coral", "blue", "lime", "violet", "gold"];
const languageStorageKey = "youtarr-feed-language";
const watchResumeRewindSeconds = 5;
const floatplanePageSize = 48;

function mergeVideosById(existing: FeedVideo[], incoming: FeedVideo[]) {
  const next = [...existing];
  const indices = new Map(next.map((video, index) => [video.id, index]));
  incoming.forEach((video) => {
    const index = indices.get(video.id);
    if (index === undefined) {
      indices.set(video.id, next.length);
      next.push(video);
    } else {
      next[index] = { ...next[index], ...video };
    }
  });
  return next;
}

function NavIcon({ view }: { view: View }) {
  const icon =
    view === "feed"
      ? faHouse
      : view === "continue"
        ? faClockRotateLeft
        : view === "local"
          ? faFolderOpen
          : view === "singles"
            ? faLink
            : view === "floatplane"
              ? faPlane
              : faList;
  return (
    <span className="nav-icon-frame">
      <FontAwesomeIcon className="nav-icon" icon={icon} aria-hidden="true" />
    </span>
  );
}

function ChannelExportLink({ copy }: { copy: AppCopy }) {
  return (
    <a
      className="settings-link export-link"
      href="/api/channels/export"
      download="youtarr-subscriptions.csv"
      aria-label={copy.channels.exportCsvAria}
    >
      <FontAwesomeIcon icon={faDownload} aria-hidden="true" />
      {copy.channels.exportCsv}
    </a>
  );
}

function DiagnosticCard({
  diagnostic,
  copy,
}: {
  diagnostic: ServiceDiagnostic;
  copy: AppCopy;
}) {
  return (
    <article className="diagnostic-card">
      <header>
        <div>
          <strong>{diagnostic.label}</strong>
          <small>
            {diagnostic.configured
              ? copy.settings.configured
              : copy.settings.notConfigured}
          </small>
        </div>
        <span
          className={`diagnostic-state ${
            diagnostic.connection.ok ? "diagnostic-ok" : "diagnostic-error"
          }`}
        >
          {diagnostic.connection.ok
            ? copy.settings.connectionOk
            : copy.settings.connectionIssue}
        </span>
      </header>
      <p>{diagnostic.connection.message}</p>
      <div className="diagnostic-settings">
        {diagnostic.settings.map((setting) => (
          <div key={setting.key}>
            <span>{setting.key}</span>
            <strong>{setting.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function formatDuration(seconds: number) {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatCompactNumber(value: number, copy: AppCopy) {
  return new Intl.NumberFormat(copy.locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function relativeDate(value: string | null, copy: AppCopy) {
  if (!value) return copy.relative.unknown;
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(difference / 60_000));
  if (minutes < 2) return copy.relative.justNow;
  if (minutes < 60) {
    return `${minutes} ${
      minutes === 1 ? copy.relative.minute : copy.relative.minutes
    } ${copy.relative.ago}`;
  }
  const hours = Math.max(1, Math.floor(difference / 3_600_000));
  if (hours < 24) {
    return `${hours} ${
      hours === 1 ? copy.relative.hour : copy.relative.hours
    } ${copy.relative.ago}`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} ${
      days === 1 ? copy.relative.day : copy.relative.days
    } ${copy.relative.ago}`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks} ${
      weeks === 1 ? copy.relative.week : copy.relative.weeks
    } ${copy.relative.ago}`;
  }
  return new Intl.DateTimeFormat(copy.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatEta(seconds: number | undefined, copy: AppCopy) {
  if (!seconds) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return copy.etaRemaining(minutes);
}

function updateMediaSession(video: FeedVideo) {
  if (
    typeof navigator === "undefined" ||
    !("mediaSession" in navigator) ||
    typeof window.MediaMetadata === "undefined"
  ) {
    return;
  }

  navigator.mediaSession.metadata = new window.MediaMetadata({
    title: video.title,
    artist: video.channelName,
    album: "Youtarr Feed",
    artwork: video.thumbnail
      ? [
          { src: video.thumbnail, sizes: "96x96", type: "image/jpeg" },
          { src: video.thumbnail, sizes: "128x128", type: "image/jpeg" },
          { src: video.thumbnail, sizes: "256x256", type: "image/jpeg" },
          { src: video.thumbnail, sizes: "512x512", type: "image/jpeg" },
        ]
      : undefined,
  });
}

function updateMediaSessionControls(player: HTMLVideoElement) {
  if (
    typeof navigator === "undefined" ||
    !("mediaSession" in navigator) ||
    !navigator.mediaSession.setActionHandler
  ) {
    return;
  }

  navigator.mediaSession.setActionHandler("play", () => {
    void player.play();
  });
  navigator.mediaSession.setActionHandler("pause", () => {
    player.pause();
  });
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) {
      player.currentTime = details.seekTime;
    }
  });
}

function ChannelAvatar({
  channel,
  size = "normal",
}: {
  channel: Pick<Channel, "id" | "name" | "avatar">;
  size?: "small" | "normal" | "large";
}) {
  const [failed, setFailed] = useState(false);
  const color = palette[
    [...channel.id].reduce((total, letter) => total + letter.charCodeAt(0), 0) %
      palette.length
  ];
  return (
    <span className={`avatar avatar-${size} avatar-${color}`}>
      {channel.avatar && !failed ? (
        // Youtarr levert deze afbeelding dynamisch via onze eigen proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={channel.avatar}
          alt=""
          onError={() => setFailed(true)}
          loading="lazy"
        />
      ) : (
        <span>{initials(channel.name)}</span>
      )}
    </span>
  );
}

function Thumbnail({
  video,
  index,
  progress,
  streamSource,
  downloadJob,
  copy,
}: {
  video: FeedVideo;
  index: number;
  progress?: number;
  streamSource?: StreamSourceInfo | null;
  downloadJob?: DownloadJob;
  copy: AppCopy;
}) {
  const [failed, setFailed] = useState(false);
  const localLabel =
    video.sourceLabel ||
    (streamSource?.source === "local"
      ? copy.common.direct
      : streamSource?.source === "youtarr"
        ? copy.common.youtarr
        : copy.common.checkingLocal);
  const badgeSource =
    video.provider === "floatplane"
      ? "floatplane"
      : streamSource?.source === "local"
        ? "direct"
        : streamSource?.source === "youtarr"
          ? "youtarr"
          : "checking";
  return (
    <div className={`thumbnail thumbnail-${palette[index % palette.length]}`}>
      {video.thumbnail && !failed ? (
        // The source varies per video; optimization is already handled by YouTube/Youtarr.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={video.thumbnail}
          alt=""
          onError={() => setFailed(true)}
          loading={index < 6 ? "eager" : "lazy"}
          fetchPriority={index < 4 ? "high" : "auto"}
        />
      ) : (
        <div className="thumbnail-art" aria-hidden="true">
          <span className="art-mark">{initials(video.channelName)}</span>
          <span className="art-line" />
          <span className="art-line art-line-short" />
        </div>
      )}
      <span className="duration">{formatDuration(video.duration)}</span>
      {video.downloaded ? (
        <span
          className={`local-badge local-badge-${badgeSource}`}
        >
          {localLabel}
        </span>
      ) : (
        <span className={`cloud-badge ${downloadJob ? `cloud-badge-${downloadJob.state}` : ""}`}>
          {downloadJob?.state === "queueing"
            ? copy.thumbnail.queueing
            : downloadJob?.state === "queued"
              ? copy.thumbnail.queued
              : downloadJob?.state === "error"
                ? copy.thumbnail.error
                : video.missing
                  ? copy.thumbnail.redownload
                  : copy.thumbnail.missing}
        </span>
      )}
      {!video.downloaded &&
        (downloadJob?.state === "queueing" || downloadJob?.state === "queued") && (
          <span className="download-thumb-overlay" aria-label={copy.thumbnail.downloadingAria}>
            <span />
          </span>
        )}
      {(video.watched || progress !== undefined) && (
        <span
          className="watched-progress"
          style={{ width: `${progress ?? 100}%` }}
        />
      )}
    </div>
  );
}

function VideoCard({
  video,
  index,
  progress,
  streamSource,
  downloadJob,
  onOpen,
  onChannel,
  onDelete,
  onRedownload,
  onRemoveFromList,
  onMarkWatched,
  onMarkUnwatched,
  isWatched,
  copy,
}: {
  video: FeedVideo;
  index: number;
  progress?: number;
  streamSource?: StreamSourceInfo | null;
  downloadJob?: DownloadJob;
  onOpen: (video: FeedVideo) => void;
  onChannel?: (channelId: string) => void;
  onDelete?: (video: FeedVideo) => void;
  onRedownload?: (video: FeedVideo) => void;
  onRemoveFromList?: (video: FeedVideo) => void;
  onMarkWatched: (video: FeedVideo) => void;
  onMarkUnwatched: (video: FeedVideo) => void;
  isWatched: boolean;
  copy: AppCopy;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const channel = {
    id: video.channelId,
    name: video.channelName,
    avatar: video.channelAvatar,
  };
  const displayVideo =
    video.watched === isWatched ? video : { ...video, watched: isWatched };
  const managesYoutarrDownload = video.provider !== "floatplane";
  return (
    <article className="video-card">
      <button
        className="thumbnail-button"
        onClick={() => onOpen(video)}
        aria-label={video.title}
      >
        <Thumbnail
          video={displayVideo}
          index={index}
          progress={progress}
          streamSource={streamSource}
          downloadJob={downloadJob}
          copy={copy}
        />
      </button>
      <div className="video-details">
        <button
          className="avatar-button"
          onClick={() => {
            if (video.provider !== "floatplane") onChannel?.(video.channelId);
          }}
          disabled={!onChannel || video.provider === "floatplane"}
          aria-label={video.channelName}
        >
          <ChannelAvatar channel={channel} size="small" />
        </button>
        <button className="video-copy" onClick={() => onOpen(video)}>
          <strong>{video.title}</strong>
          <span>
            {video.channelName} · {relativeDate(video.publishedAt, copy)}
          </span>
        </button>
        <div className="video-menu-wrap">
          <button
            ref={menuButtonRef}
            className="more-button"
            aria-label={copy.menu.more}
            aria-expanded={menuOpen}
            onClick={() => {
              const rect = menuButtonRef.current?.getBoundingClientRect();
              setMenuUp(Boolean(rect && window.innerHeight - rect.bottom < 230));
              setMenuOpen((open) => !open);
            }}
          >
            <FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className={`video-menu ${menuUp ? "video-menu-up" : ""}`}>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpen(video);
                }}
              >
                {video.downloaded
                  ? copy.common.play
                  : downloadJob?.state === "error"
                    ? copy.menu.retryDownload
                    : downloadJob
                      ? copy.menu.downloadRunning
                      : video.missing
                        ? copy.menu.redownload
                        : copy.menu.fetch}
              </button>
              {video.downloaded && (
                <>
                  {managesYoutarrDownload && onRedownload && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onRedownload(video);
                      }}
                    >
                      {downloadJob
                        ? copy.menu.downloadRunning
                        : copy.menu.redownload}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      if (isWatched) onMarkUnwatched(video);
                      else onMarkWatched(video);
                    }}
                  >
                    {isWatched ? copy.common.markUnwatched : copy.common.markWatched}
                  </button>
                  {managesYoutarrDownload && onDelete && (
                    <button
                      className="danger-menu-item"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete(video);
                      }}
                    >
                      {copy.common.deleteDownload}
                    </button>
                  )}
                </>
              )}
              {onRemoveFromList && (
                <button
                  className="danger-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemoveFromList(video);
                  }}
                >
                  {copy.common.removeFromSingles}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function LoadingGrid({ copy }: { copy: AppCopy }) {
  return (
    <div className="video-grid" aria-label={copy.common.loadingFeed}>
      {Array.from({ length: 8 }).map((_, index) => (
        <div className="video-card loading-card" key={index}>
          <div className="loading-thumb" />
          <div className="loading-meta">
            <span className="loading-avatar" />
            <span className="loading-lines">
              <i />
              <i />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FeedApp() {
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window === "undefined") return defaultLanguage;
    const storedLanguage = window.localStorage.getItem(languageStorageKey);
    return isLanguage(storedLanguage) ? storedLanguage : defaultLanguage;
  });
  const [view, setView] = useState<View>("feed");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelVideos, setChannelVideos] = useState<FeedVideo[]>([]);
  const [channelLoading, setChannelLoading] = useState(false);
  const [localVideos, setLocalVideos] = useState<FeedVideo[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [singleVideos, setSingleVideos] = useState<FeedVideo[]>([]);
  const [singleLoading, setSingleLoading] = useState(false);
  const [floatplaneVideos, setFloatplaneVideos] = useState<FeedVideo[]>([]);
  const [floatplaneChannels, setFloatplaneChannels] = useState<Channel[]>([]);
  const [floatplaneLoading, setFloatplaneLoading] = useState(false);
  const [floatplaneLoadingMore, setFloatplaneLoadingMore] = useState(false);
  const [floatplaneHasMore, setFloatplaneHasMore] = useState(false);
  const [floatplaneNextOffset, setFloatplaneNextOffset] = useState(0);
  const [floatplaneCreatorFilter, setFloatplaneCreatorFilter] = useState("all");
  const [selectedVideo, setSelectedVideo] = useState<FeedVideo | null>(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode>("full");
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [downloadJobs, setDownloadJobs] = useState<Record<string, DownloadJob>>({});
  const [deleteState, setDeleteState] = useState<"idle" | "deleting" | "error">(
    "idle"
  );
  const [deleteError, setDeleteError] = useState("");
  const [activity, setActivity] = useState<DownloadActivity | null>(null);
  const [watchProgress, setWatchProgress] = useState<WatchProgressMap>({});
  const [watchedVideoIds, setWatchedVideoIds] = useState<string[]>([]);
  const [unwatchedVideoIds, setUnwatchedVideoIds] = useState<string[]>([]);
  const [channelUrl, setChannelUrl] = useState("");
  const [addChannelState, setAddChannelState] = useState<
    "idle" | "adding" | "added" | "error"
  >("idle");
  const [addChannelMessage, setAddChannelMessage] = useState("");
  const [singleVideoUrl, setSingleVideoUrl] = useState("");
  const [singleVideoState, setSingleVideoState] = useState<
    "idle" | "adding" | "added" | "error"
  >("idle");
  const [singleVideoMessage, setSingleVideoMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsChecking, setSettingsChecking] = useState(false);
  const [floatplaneSessionToken, setFloatplaneSessionToken] = useState("");
  const [floatplaneSessionState, setFloatplaneSessionState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [floatplaneSessionMessage, setFloatplaneSessionMessage] = useState("");
  const [standaloneMode, setStandaloneMode] = useState(false);
  const [streamSource, setStreamSource] = useState<StreamSourceInfo | null>(null);
  const [streamSources, setStreamSources] = useState<Record<string, StreamSourceInfo>>({});
  const [videoMetadata, setVideoMetadata] = useState<Record<string, VideoMetadataInfo>>({});
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({});
  const progressSaveRef = useRef<Record<string, number>>({});
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playerDragRef = useRef<PlayerDragState | null>(null);
  const intendedPlaybackRef = useRef(false);
  const pauseIntentTimerRef = useRef<number | null>(null);
  const floatplaneLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const mode: AppMode = feed?.mode || "demo";
  const copy = translations[language];
  const shouldUseInlineWatchPage = useCallback(() => true, []);

  useEffect(() => {
    window.localStorage.setItem(languageStorageKey, language);
    document.documentElement.lang = language;
  }, [language]);

  const loadFeed = useCallback(async (quiet = false, refresh = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    if (refresh) {
      setStreamSources({});
      setStreamSource(null);
    }
    setError("");
    try {
      const [feedResponse, statusResponse, progressResponse] = await Promise.all([
        fetch(`/api/feed${refresh ? "?refresh=1" : ""}`, { cache: "no-store" }),
        fetch("/api/status", { cache: "no-store" }),
        fetch(`/api/watch-progress${refresh ? "?refresh=1" : ""}`, {
          cache: "no-store",
        }),
      ]);
      const feedData = (await feedResponse.json()) as FeedResponse & {
        error?: string;
      };
      const statusData = (await statusResponse.json()) as FeedStatus;
      if (!feedResponse.ok) throw new Error(feedData.error || copy.errors.loadFeed);
      setFeed(feedData);
      setStatus(statusData);
      if (progressResponse.ok) {
        const progressData = (await progressResponse.json()) as {
          progress?: WatchProgressMap;
          watchedVideoIds?: string[];
          unwatchedVideoIds?: string[];
        };
        setWatchProgress(progressData.progress || {});
        setWatchedVideoIds(progressData.watchedVideoIds || []);
        setUnwatchedVideoIds(progressData.unwatchedVideoIds || []);
      }
      if (!refresh && feedResponse.headers.get("X-Youtarr-Feed-Cache") === "stale") {
        window.setTimeout(() => void loadFeed(true, true), 500);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : copy.errors.loadFeed
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [copy.errors.loadFeed]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFeed(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFeed]);

  const refreshStatus = useCallback(async () => {
    setSettingsChecking(true);
    try {
      const response = await fetch("/api/status?check=1", { cache: "no-store" });
      if (!response.ok) return;
      setStatus((await response.json()) as FeedStatus);
    } finally {
      setSettingsChecking(false);
    }
  }, []);

  async function submitFloatplaneSessionToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = floatplaneSessionToken.trim();
    if (!token) {
      setFloatplaneSessionState("error");
      setFloatplaneSessionMessage(copy.settings.floatplaneSessionTokenRequired);
      return;
    }
    setFloatplaneSessionState("saving");
    setFloatplaneSessionMessage("");
    try {
      const response = await fetch("/api/floatplane/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json()) as {
        diagnostic?: ServiceDiagnostic;
        error?: string;
      };
      if (data.diagnostic) {
        setStatus((current) =>
          current?.diagnostics
            ? {
                ...current,
                diagnostics: {
                  ...current.diagnostics,
                  floatplane: data.diagnostic,
                },
              }
            : current
        );
      }
      if (!response.ok) {
        throw new Error(data.error || copy.settings.floatplaneSessionError);
      }
      setFloatplaneSessionToken("");
      setFloatplaneSessionState("saved");
      setFloatplaneSessionMessage(copy.settings.floatplaneSessionSaved);
      if (view === "floatplane") {
        void loadFloatplaneVideos(true, true);
      }
    } catch (saveFailure) {
      setFloatplaneSessionState("error");
      setFloatplaneSessionMessage(
        saveFailure instanceof Error
          ? saveFailure.message
          : copy.settings.floatplaneSessionError
      );
    }
  }

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const timer = window.setTimeout(() => void refreshStatus(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshStatus, settingsOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSingleVideos(true), 0);
    return () => window.clearTimeout(timer);
    // loadSingleVideos is intentionally local to this component and this is a one-time boot load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const updateStandaloneMode = () => {
      setStandaloneMode(
        standaloneQuery.matches ||
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
      );
    };
    updateStandaloneMode();
    standaloneQuery.addEventListener("change", updateStandaloneMode);
    return () => {
      standaloneQuery.removeEventListener("change", updateStandaloneMode);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    async function loadWatchProgress() {
      try {
        const response = await fetch("/api/watch-progress", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          progress?: WatchProgressMap;
          watchedVideoIds?: string[];
          unwatchedVideoIds?: string[];
        };
        if (!stopped) setWatchProgress(data.progress || {});
        if (!stopped) setWatchedVideoIds(data.watchedVideoIds || []);
        if (!stopped) setUnwatchedVideoIds(data.unwatchedVideoIds || []);
      } catch {
        // Watch progress should never block the feed.
      }
    }
    void loadWatchProgress();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    if (status?.mode !== "live") {
      return;
    }
    let stopped = false;
    async function loadActivity() {
      try {
        const response = await fetch("/api/activity", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as DownloadActivity;
        if (!stopped) setActivity(data);
      } catch {
        // The next poll tries again.
      }
    }
    void loadActivity();
    const timer = window.setInterval(loadActivity, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [status?.mode]);

  useEffect(() => {
    const queuedJobs = Object.entries(downloadJobs).filter(
      ([, job]) => job.state === "queued"
    );
    if (queuedJobs.length === 0 || status?.mode !== "live") return;

    let stopped = false;
    async function checkDownloads() {
      const jobsByChannel = new Map<string, string[]>();
      const singleVideoIds: string[] = [];
      queuedJobs.forEach(([videoId, job]) => {
        if (job.channelId.startsWith("single:")) {
          singleVideoIds.push(videoId);
          return;
        }
        jobsByChannel.set(job.channelId, [
          ...(jobsByChannel.get(job.channelId) || []),
          videoId,
        ]);
      });

      const completed: string[] = [];
      await Promise.all(
        [...jobsByChannel.entries()].map(async ([channelId, videoIds]) => {
          try {
            const response = await fetch(
              `/api/channels/${encodeURIComponent(channelId)}`,
              { cache: "no-store" }
            );
            if (!response.ok) return;
            const data = (await response.json()) as { videos: FeedVideo[] };
            data.videos.forEach((video) => {
              if (video.downloaded && videoIds.includes(video.id)) {
                completed.push(video.id);
                markVideoDownloaded(video);
              }
            });
          } catch {
            // The next poll tries again.
          }
        })
      );

      if (singleVideoIds.length > 0) {
        try {
          const response = await fetch("/api/single-videos", { cache: "no-store" });
          if (response.ok) {
            const data = (await response.json()) as { videos?: FeedVideo[] };
            setSingleVideos(data.videos || []);
            (data.videos || []).forEach((video) => {
              if (video.downloaded && singleVideoIds.includes(video.id)) {
                completed.push(video.id);
                markVideoDownloaded(video);
              }
            });
          }
        } catch {
          // The next poll tries again.
        }
      }

      if (stopped || completed.length === 0) return;
      setDownloadJobs((current) => {
        const next = { ...current };
        completed.forEach((id) => delete next[id]);
        return next;
      });
      if (status?.plexConfigured) {
        void fetch("/api/plex/refresh", { method: "POST" });
      }
      if (view === "local") {
        void loadLocalVideos(true, true);
      }
      if (view === "singles") {
        void loadSingleVideos(true);
      }
    }

    void checkDownloads();
    const timer = window.setInterval(checkDownloads, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // Local loaders are intentionally local to this component; queued jobs drive polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadJobs, status?.mode, status?.plexConfigured, view]);

  useEffect(() => {
    if (view === "local") {
      void loadLocalVideos(localVideos.length > 0);
    }
    if (view === "singles") {
      void loadSingleVideos(singleVideos.length > 0);
    }
    if (view === "floatplane") {
      void loadFloatplaneVideos(floatplaneVideos.length > 0);
    }
    // Local loaders are intentionally local to this component; view changes drive refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (
      playerMode === "full" &&
      selectedVideo &&
      selectedVideo.downloaded &&
      (mode === "live" || selectedVideo.provider === "floatplane") &&
      playerRef.current &&
      !shouldUseInlineWatchPage()
    ) {
      updateMediaSession(selectedVideo);
      void requestNativeFullscreen(playerRef.current);
    }
  }, [mode, playerMode, selectedVideo, shouldUseInlineWatchPage]);

  useEffect(() => {
    if (!selectedVideo || videoMetadata[selectedVideo.id]) return;
    const video = selectedVideo;

    let stopped = false;
    async function loadVideoMetadata() {
      try {
        const response = await fetch(
          `/api/video-metadata/${encodeURIComponent(video.id)}`,
          { cache: "no-store" }
        );
        if (!response.ok) return;
        const data = (await response.json()) as VideoMetadataInfo;
        if (!stopped) {
          setVideoMetadata((current) => ({
            ...current,
            [video.id]: data,
          }));
        }
      } catch {
        // Metadata is optional; playback should not depend on it.
      }
    }

    void loadVideoMetadata();
    return () => {
      stopped = true;
    };
  }, [selectedVideo, videoMetadata]);

  useEffect(() => {
    if (
      !selectedVideo ||
      !selectedVideo.downloaded ||
      (mode !== "live" && selectedVideo.provider !== "floatplane") ||
      playerMode !== "full" ||
      !shouldUseInlineWatchPage()
    ) {
      return;
    }

    const requestLandscapeFullscreen = () => {
      const isPhoneLandscape =
        window.innerWidth <= 900 &&
        window.matchMedia("(orientation: landscape)").matches;
      if (isPhoneLandscape && playerRef.current) {
        void requestNativeFullscreen(playerRef.current);
      }
    };

    const timer = window.setTimeout(requestLandscapeFullscreen, 120);
    window.addEventListener("orientationchange", requestLandscapeFullscreen);
    window.addEventListener("resize", requestLandscapeFullscreen);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("orientationchange", requestLandscapeFullscreen);
      window.removeEventListener("resize", requestLandscapeFullscreen);
    };
  }, [
    mode,
    playerMode,
    selectedVideo,
    shouldUseInlineWatchPage,
  ]);

  useEffect(() => {
    const refreshSourceLabels = () => {
      if (document.visibilityState !== "visible") return;
      setStreamSources({});
      setStreamSource(null);
    };

    document.addEventListener("visibilitychange", refreshSourceLabels);
    window.addEventListener("focus", refreshSourceLabels);
    return () => {
      document.removeEventListener("visibilitychange", refreshSourceLabels);
      window.removeEventListener("focus", refreshSourceLabels);
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (
      !player ||
      !selectedVideo?.downloaded ||
      (mode !== "live" && selectedVideo.provider !== "floatplane")
    ) {
      return;
    }

    const minimizeAfterNativeFullscreen = () => {
      setPlayerMode("mini");
      updateMediaSession(selectedVideo);
      if (intendedPlaybackRef.current) {
        if (pauseIntentTimerRef.current) {
          window.clearTimeout(pauseIntentTimerRef.current);
          pauseIntentTimerRef.current = null;
        }
        window.setTimeout(() => {
          if (intendedPlaybackRef.current && !player.ended) {
            void player.play().catch(() => {
              // iOS may reject resume; the mini player remains paused.
            });
          }
        }, 120);
      }
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        minimizeAfterNativeFullscreen();
      }
    };

    player.addEventListener("webkitendfullscreen", minimizeAfterNativeFullscreen);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      player.removeEventListener(
        "webkitendfullscreen",
        minimizeAfterNativeFullscreen
      );
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [mode, selectedVideo]);

  useEffect(() => {
    intendedPlaybackRef.current = false;
    if (pauseIntentTimerRef.current) {
      window.clearTimeout(pauseIntentTimerRef.current);
      pauseIntentTimerRef.current = null;
    }
  }, [selectedVideo?.id]);

  useEffect(() => {
    const player = playerRef.current;
    if (
      !player ||
      selectedVideo?.provider !== "floatplane" ||
      streamSource?.stream?.playbackMode !== "hls"
    ) {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      return undefined;
    }
    const hlsSource = `/api/floatplane/stream/${encodeURIComponent(
      selectedVideo.id
    )}`;

    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (player.canPlayType("application/vnd.apple.mpegurl")) {
      return undefined;
    }
    player.removeAttribute("src");
    player.load();

    let stopped = false;
    void import("hls.js").then(({ default: HlsPlayer }) => {
      if (stopped || !HlsPlayer.isSupported()) return;
      const hls = new HlsPlayer({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(hlsSource);
      hls.attachMedia(player);
      hlsRef.current = hls;
    });

    return () => {
      stopped = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [
    selectedVideo?.id,
    selectedVideo?.provider,
    streamSource?.stream?.playbackMode,
  ]);

  useEffect(() => {
    let stopped = false;
    const resetTimer = window.setTimeout(() => {
      if (!stopped) setStreamSource(null);
    }, 0);

    async function loadStreamSource() {
      if (
        !selectedVideo?.downloaded ||
        (mode !== "live" && selectedVideo.provider !== "floatplane")
      ) {
        return;
      }
      if (selectedVideo.provider === "floatplane") {
        try {
          const response = await fetch(
            `/api/floatplane/stream/${encodeURIComponent(selectedVideo.id)}/source`,
            { cache: "no-store" }
          );
          const data = response.ok
            ? ((await response.json()) as StreamSourceInfo)
            : null;
          setStreamSource(
            data || {
              source: "floatplane",
              youtarrConfigured: true,
              playbackLabel: selectedVideo.sourceLabel || "Floatplane",
            }
          );
        } catch {
          setStreamSource({
            source: "floatplane",
            youtarrConfigured: true,
            playbackLabel: selectedVideo.sourceLabel || "Floatplane",
          });
        }
        return;
      }
      try {
        const response = await fetch(
          `/api/stream/${encodeURIComponent(selectedVideo.id)}/source?detail=1`,
          { cache: "no-store" }
        );
        if (!response.ok) return;
        const data = (await response.json()) as StreamSourceInfo;
        if (!stopped) setStreamSource(data);
      } catch {
        // Source info is diagnostic only; playback should not depend on it.
      }
    }

    void loadStreamSource();
    return () => {
      stopped = true;
      window.clearTimeout(resetTimer);
    };
  }, [
    mode,
    selectedVideo?.downloaded,
    selectedVideo?.id,
    selectedVideo?.provider,
    selectedVideo?.sourceLabel,
  ]);

  const visibleVideos = useMemo(() => {
    const source = selectedChannel ? channelVideos : feed?.videos || [];
    const normalized = query.trim().toLowerCase();
    return source.filter((video) => {
      if (filter === "new" && video.downloaded) return false;
      if (filter === "downloaded" && !video.downloaded) return false;
      if (
        normalized &&
        !`${video.title} ${video.channelName}`.toLowerCase().includes(normalized)
      ) {
        return false;
      }
      return true;
    });
  }, [channelVideos, feed?.videos, filter, query, selectedChannel]);

  const continueVideos = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const progressVideos = [
      ...(feed?.videos || []),
      ...singleVideos,
      ...floatplaneVideos,
    ];
    return progressVideos
      .filter((video) => {
        if (!video.downloaded || !watchProgress[video.id]) return false;
        if (
          normalized &&
          !`${video.title} ${video.channelName}`.toLowerCase().includes(normalized)
        ) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          (watchProgress[b.id]?.updatedAt || 0) -
          (watchProgress[a.id]?.updatedAt || 0)
      );
  }, [feed?.videos, floatplaneVideos, query, singleVideos, watchProgress]);

  const filteredLocalVideos = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return localVideos.filter((video) => {
      if (
        normalized &&
        !`${video.title} ${video.channelName}`.toLowerCase().includes(normalized)
      ) {
        return false;
      }
      return true;
    });
  }, [localVideos, query]);

  const filteredSingleVideos = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return singleVideos.filter((video) => {
      if (
        normalized &&
        !`${video.title} ${video.channelName}`.toLowerCase().includes(normalized)
      ) {
        return false;
      }
      return true;
    });
  }, [query, singleVideos]);

  const floatplaneCreators = useMemo(
    () => [
      ...new Map(
        [
          ...floatplaneChannels.map((channel) => [
            channel.id,
            { id: channel.id, name: channel.name },
          ]),
          ...floatplaneVideos.map((video) => [
            video.channelId,
            { id: video.channelId, name: video.channelName },
          ]),
        ] as Array<[string, { id: string; name: string }]>
      ).values(),
    ].sort((left, right) => left.name.localeCompare(right.name)),
    [floatplaneChannels, floatplaneVideos]
  );

  const filteredFloatplaneVideos = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return floatplaneVideos.filter((video) => {
      if (
        floatplaneCreatorFilter !== "all" &&
        video.channelId !== floatplaneCreatorFilter
      ) {
        return false;
      }
      if (
        normalized &&
        !`${video.title} ${video.channelName}`.toLowerCase().includes(normalized)
      ) {
        return false;
      }
      return true;
    });
  }, [floatplaneCreatorFilter, floatplaneVideos, query]);

  useEffect(() => {
    if (mode !== "live") return;
    const source =
      view === "continue"
        ? continueVideos
        : view === "local"
          ? filteredLocalVideos
          : view === "singles"
            ? filteredSingleVideos
            : view === "floatplane"
              ? filteredFloatplaneVideos
            : visibleVideos;
    const candidates = source
      .filter(
        (video) =>
          video.provider !== "floatplane" &&
          video.downloaded &&
          !streamSources[video.id]
      )
      .slice(0, 80);
    if (candidates.length === 0) return;

    let stopped = false;
    async function loadCardSources() {
      const entries = await Promise.all(
        candidates.map(async (video) => {
          try {
            const response = await fetch(
              `/api/stream/${encodeURIComponent(video.id)}/source`,
              { cache: "no-store" }
            );
            if (!response.ok) return null;
            return [video.id, (await response.json()) as StreamSourceInfo] as const;
          } catch {
            return null;
          }
        })
      );
      if (stopped) return;
      setStreamSources((current) => {
        const next = { ...current };
        entries.forEach((entry) => {
          if (entry) next[entry[0]] = entry[1];
        });
        return next;
      });
    }

    void loadCardSources();
    return () => {
      stopped = true;
    };
  }, [
    continueVideos,
    filteredFloatplaneVideos,
    filteredLocalVideos,
    filteredSingleVideos,
    mode,
    streamSources,
    view,
    visibleVideos,
  ]);

  async function loadLocalVideos(quiet = false, refresh = false) {
    if (!quiet) setLocalLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/local-videos${refresh ? "?refresh=1" : ""}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as {
        videos?: FeedVideo[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || copy.errors.loadLocal);
      setLocalVideos(data.videos || []);
      if (!refresh && response.headers.get("X-Youtarr-Feed-Cache") === "stale") {
        window.setTimeout(() => void loadLocalVideos(true, true), 500);
      }
    } catch (localError) {
      setError(
        localError instanceof Error
          ? localError.message
          : copy.errors.loadLocal
      );
    } finally {
      setLocalLoading(false);
    }
  }

  async function loadSingleVideos(quiet = false) {
    if (!quiet) setSingleLoading(true);
    setError("");
    try {
      const response = await fetch("/api/single-videos", { cache: "no-store" });
      const data = (await response.json()) as {
        videos?: FeedVideo[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || copy.errors.loadSingles);
      }
      setSingleVideos(data.videos || []);
    } catch (singleError) {
      setError(
        singleError instanceof Error
          ? singleError.message
          : copy.errors.loadSingles
      );
    } finally {
      setSingleLoading(false);
    }
  }

  async function loadFloatplaneVideos(
    quiet = false,
    refresh = false,
    append = false
  ) {
    if (append && (floatplaneLoading || floatplaneLoadingMore || !floatplaneHasMore)) {
      return;
    }
    const offset = append ? floatplaneNextOffset : 0;
    if (append) {
      setFloatplaneLoadingMore(true);
    } else if (!quiet) {
      setFloatplaneLoading(true);
    }
    setError("");
    try {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(floatplanePageSize),
      });
      if (refresh) params.set("refresh", "1");
      const response = await fetch(
        `/api/floatplane/feed?${params.toString()}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as FloatplaneFeedPage;
      if (!response.ok) {
        throw new Error(data.error || copy.errors.loadFloatplane);
      }
      const incomingVideos = data.videos || [];
      setFloatplaneChannels(data.channels || []);
      setFloatplaneVideos((current) =>
        append ? mergeVideosById(current, incomingVideos) : incomingVideos
      );
      setFloatplaneHasMore(Boolean(data.hasMore));
      setFloatplaneNextOffset(
        typeof data.nextOffset === "number"
          ? data.nextOffset
          : offset + incomingVideos.length
      );
      if (
        !append &&
        !refresh &&
        response.headers.get("X-Youtarr-Feed-Cache") === "stale"
      ) {
        window.setTimeout(() => void loadFloatplaneVideos(true, true), 500);
      }
    } catch (floatplaneError) {
      setError(
        floatplaneError instanceof Error
          ? floatplaneError.message
          : copy.errors.loadFloatplane
      );
    } finally {
      if (append) {
        setFloatplaneLoadingMore(false);
      } else {
        setFloatplaneLoading(false);
      }
    }
  }

  useEffect(() => {
    if (
      view !== "floatplane" ||
      !floatplaneHasMore ||
      floatplaneLoading ||
      floatplaneLoadingMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return undefined;
    }
    const target = floatplaneLoadMoreRef.current;
    if (!target) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadFloatplaneVideos(true, false, true);
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
    // loadFloatplaneVideos is intentionally local; pagination state controls this observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    floatplaneHasMore,
    floatplaneLoading,
    floatplaneLoadingMore,
    floatplaneNextOffset,
    view,
  ]);

  function markVideoDownloaded(updatedVideo: FeedVideo) {
    const updated = { ...updatedVideo, downloaded: true };
    const updateList = (videos: FeedVideo[]) =>
      videos.map((video) =>
        video.id === updated.id ? { ...video, ...updated } : video
      );

    setFeed((current) =>
      current ? { ...current, videos: updateList(current.videos) } : current
    );
    setChannelVideos((current) => updateList(current));
    setLocalVideos((current) => updateList(current));
    setSingleVideos((current) => updateList(current));
    setFloatplaneVideos((current) => updateList(current));
    setStreamSources((current) => {
      if (!current[updated.id]) return current;
      const next = { ...current };
      delete next[updated.id];
      return next;
    });
    if (selectedVideo?.id === updated.id) {
      setStreamSource(null);
    }
    setSelectedVideo((current) =>
      current?.id === updated.id ? { ...current, ...updated } : current
    );
  }

  function markVideoDeleted(videoId: string) {
    const updateList = (videos: FeedVideo[]) =>
      videos.map((video) =>
        video.id === videoId
          ? { ...video, downloaded: false, missing: true, watched: false }
          : video
      );

    setFeed((current) =>
      current ? { ...current, videos: updateList(current.videos) } : current
    );
    setChannelVideos((current) => updateList(current));
    setLocalVideos((current) => current.filter((item) => item.id !== videoId));
    setSingleVideos((current) => updateList(current));
    setFloatplaneVideos((current) => updateList(current));
    setStreamSources((current) => {
      if (!current[videoId]) return current;
      const next = { ...current };
      delete next[videoId];
      return next;
    });
    setStreamSource(null);
    setWatchProgress((current) => {
      if (!current[videoId]) return current;
      const next = { ...current };
      delete next[videoId];
      return next;
    });
    setWatchedVideoIds((current) => current.filter((id) => id !== videoId));
    setUnwatchedVideoIds((current) => current.filter((id) => id !== videoId));
    setSelectedVideo((current) => (current?.id === videoId ? null : current));
  }

  function isVideoWatched(video: FeedVideo) {
    if (unwatchedVideoIds.includes(video.id)) return false;
    return video.watched || watchedVideoIds.includes(video.id);
  }

  function markVideoWatchedLocal(videoId: string, watched: boolean) {
    const updateList = (videos: FeedVideo[]) =>
      videos.map((video) =>
        video.id === videoId ? { ...video, watched } : video
      );

    setFeed((current) =>
      current ? { ...current, videos: updateList(current.videos) } : current
    );
    setChannelVideos((current) => updateList(current));
    setLocalVideos((current) => updateList(current));
    setSingleVideos((current) => updateList(current));
    setFloatplaneVideos((current) => updateList(current));
    setSelectedVideo((current) =>
      current?.id === videoId ? { ...current, watched } : current
    );
    setWatchProgress((current) => {
      if (!current[videoId]) return current;
      const next = { ...current };
      delete next[videoId];
      return next;
    });
    setWatchedVideoIds((current) => {
      const next = new Set(current);
      if (watched) next.add(videoId);
      else next.delete(videoId);
      return [...next];
    });
    setUnwatchedVideoIds((current) => {
      const next = new Set(current);
      if (watched) next.delete(videoId);
      else next.add(videoId);
      return [...next];
    });
  }

  async function setVideoWatched(video: FeedVideo, watched: boolean) {
    markVideoWatchedLocal(video.id, watched);
    try {
      const response = await fetch("/api/watch-progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: video.id,
          watched,
          thumbnail: video.thumbnail,
        }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        progress?: WatchProgressMap;
        watchedVideoIds?: string[];
        unwatchedVideoIds?: string[];
      };
      if (data.progress) setWatchProgress(data.progress);
      if (data.watchedVideoIds) setWatchedVideoIds(data.watchedVideoIds);
      if (data.unwatchedVideoIds) setUnwatchedVideoIds(data.unwatchedVideoIds);
    } catch {
      // The next refresh reconciles with the server.
    }
  }

  async function openChannel(channelId: string) {
    const channel = feed?.channels.find((item) => item.id === channelId);
    if (!channel) return;
    setSelectedChannel(channel);
    setView("channels");
    setChannelLoading(true);
    setChannelVideos([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const response = await fetch(
        `/api/channels/${encodeURIComponent(channelId)}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as {
        videos?: FeedVideo[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || copy.errors.loadChannel);
      setChannelVideos(data.videos || []);
    } catch (channelError) {
      setError(
        channelError instanceof Error
          ? channelError.message
          : copy.errors.loadChannel
      );
    } finally {
      setChannelLoading(false);
    }
  }

  async function openVideo(video: FeedVideo) {
    if (!video.downloaded) {
      if (mode === "live") {
        try {
          const response = await fetch(
            `/api/stream/${encodeURIComponent(video.id)}/source`,
            { cache: "no-store" }
          );
          if (response.ok) {
            const source = (await response.json()) as StreamSourceInfo;
            setStreamSources((current) => ({ ...current, [video.id]: source }));
            if (source.source === "local") {
              const downloadedVideo = { ...video, downloaded: true };
              markVideoDownloaded(downloadedVideo);
              setSelectedVideo(downloadedVideo);
              setPlayerMode("full");
              setPlayerPlaying(false);
              setDeleteState("idle");
              setDeleteError("");
              return;
            }
          }
        } catch {
          // Fall through to the regular download path.
        }
      }
      void startDownload(video);
      return;
    }
    setSelectedVideo(video);
    setPlayerMode("full");
    setPlayerPlaying(false);
    setDeleteState("idle");
    setDeleteError("");
  }

  function handlePlayerDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (playerMode !== "full" || !selectedVideo?.downloaded) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    playerDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: Date.now(),
    };
  }

  function handlePlayerDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = playerDragRef.current;
    if (!drag) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  }

  function handlePlayerDragEnd() {
    const drag = playerDragRef.current;
    playerDragRef.current = null;
    if (!drag || playerMode !== "full" || !selectedVideo?.downloaded) return;

    const deltaX = drag.lastX - drag.startX;
    const deltaY = drag.lastY - drag.startY;
    const elapsed = Math.max(1, Date.now() - drag.startedAt);
    const velocity = deltaY / elapsed;
    if (deltaY > 78 && Math.abs(deltaX) < 110 && velocity > 0.18) {
      setPlayerMode("mini");
    }
  }

  function requestPlayerFullscreen() {
    if (playerRef.current) {
      void requestNativeFullscreen(playerRef.current);
    }
  }

  function closePlayer() {
    if (
      selectedVideo?.downloaded &&
      (mode === "live" || selectedVideo.provider === "floatplane") &&
      playerMode === "full"
    ) {
      setPlayerMode("mini");
      return;
    }
    playerRef.current?.pause();
    intendedPlaybackRef.current = false;
    setPlayerPlaying(false);
    setSelectedVideo(null);
  }

  function toggleMiniPlayback() {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused || player.ended) {
      intendedPlaybackRef.current = true;
      void player.play().catch(() => {
        intendedPlaybackRef.current = false;
        setPlayerPlaying(false);
      });
      return;
    }
    intendedPlaybackRef.current = false;
    player.pause();
  }

  function openSelectedVideoInVlc(video: FeedVideo) {
    if (playerRef.current) {
      storePlayerWatchProgress(video, playerRef.current, true);
      playerRef.current.pause();
    }

    const streamPath =
      video.provider === "floatplane"
        ? `/api/floatplane/stream/${encodeURIComponent(video.id)}`
        : `/api/stream/${encodeURIComponent(video.id)}`;
    const streamUrl = new URL(
      streamPath,
      window.location.origin
    );
    streamUrl.searchParams.set("direct", "1");
    window.location.href = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(
      streamUrl.toString()
    )}`;
  }

  async function requestNativeFullscreen(player: HTMLVideoElement) {
    try {
      const webkitPlayer = player as WebKitVideoElement;
      if (webkitPlayer.webkitEnterFullscreen) {
        webkitPlayer.webkitEnterFullscreen();
        return;
      }
      if (player.requestFullscreen) {
        await player.requestFullscreen();
      }
    } catch {
      // iOS accepts fullscreen only when Safari allows the gesture.
    }
  }

  async function requestManualPictureInPicture(player: HTMLVideoElement) {
    const webkitPlayer = player as WebKitVideoElement;
    try {
      if (
        webkitPlayer.webkitSetPresentationMode &&
        webkitPlayer.webkitSupportsPresentationMode?.("picture-in-picture") &&
        webkitPlayer.webkitPresentationMode !== "picture-in-picture"
      ) {
        webkitPlayer.webkitSetPresentationMode("picture-in-picture");
        return;
      }
      if (
        document.pictureInPictureEnabled &&
        "requestPictureInPicture" in player &&
        !document.pictureInPictureElement
      ) {
        await (
          player as HTMLVideoElement & {
            requestPictureInPicture: () => Promise<PictureInPictureWindow>;
          }
        ).requestPictureInPicture();
      }
    } catch {
      // iOS/Safari decides whether PiP is available in standalone PWAs.
    }
  }

  async function startDownload(video: FeedVideo, redownload = false) {
    const existing = downloadJobs[video.id];
    if (existing && existing.state !== "error") return;
    setDownloadJobs((current) => ({
      ...current,
      [video.id]: { state: "queueing", channelId: video.channelId },
    }));
    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: video.id,
          missing: video.missing,
          redownload,
          channelId: video.channelId,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        demo?: boolean;
      };
      if (!response.ok) throw new Error(data.error || copy.errors.startDownload);
      setDownloadJobs((current) => ({
        ...current,
        [video.id]: { state: "queued", channelId: video.channelId },
      }));
      if (data.demo) {
        window.setTimeout(() => {
          markVideoDownloaded({ ...video, downloaded: true });
          setDownloadJobs((current) => {
            const next = { ...current };
            delete next[video.id];
            return next;
          });
        }, 3200);
      }
    } catch (downloadFailure) {
      const message =
        downloadFailure instanceof Error
          ? downloadFailure.message
          : copy.errors.startDownload;
      setDownloadJobs((current) => ({
        ...current,
        [video.id]: { state: "error", channelId: video.channelId, error: message },
      }));
      setError(message);
    }
  }

  function knownVideoDuration(video: FeedVideo) {
    const savedDuration = watchProgress[video.id]?.duration || 0;
    return Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : savedDuration;
  }

  function playerProgressDuration(video: FeedVideo, player: HTMLVideoElement) {
    return Number.isFinite(player.duration) && player.duration > 0
      ? player.duration
      : knownVideoDuration(video);
  }

  function storePlayerWatchProgress(
    video: FeedVideo,
    player: HTMLVideoElement,
    force = false
  ) {
    const duration = playerProgressDuration(video, player);
    const currentTime = Math.max(
      0,
      Math.min(player.currentTime, duration || player.currentTime)
    );
    storeWatchProgress(video.id, currentTime, duration, force, video.thumbnail);
  }

  function storeWatchProgress(
    videoId: string,
    currentTime: number,
    duration: number,
    force = false,
    thumbnail?: string
  ) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    if (!force && now - (progressSaveRef.current[videoId] || 0) < 4000) return;
    progressSaveRef.current[videoId] = now;
    const watched = currentTime > duration - 8;

    let nextEntry: WatchProgressEntry | null = null;
    setWatchProgress((current) => {
      const next = { ...current };
      if (currentTime < 5 || watched) {
        delete next[videoId];
      } else {
        nextEntry = { videoId, currentTime, duration, updatedAt: now };
        next[videoId] = nextEntry;
      }
      return next;
    });
    if (watched) {
      markVideoWatchedLocal(videoId, true);
    }

    void fetch("/api/watch-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId,
        currentTime,
        duration,
        thumbnail,
      }),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          progress?: WatchProgressMap;
          watchedVideoIds?: string[];
          unwatchedVideoIds?: string[];
        };
        if (data.progress) setWatchProgress(data.progress);
        if (data.watchedVideoIds) setWatchedVideoIds(data.watchedVideoIds);
        if (data.unwatchedVideoIds) setUnwatchedVideoIds(data.unwatchedVideoIds);
      })
      .catch(() => {
        const fallbackEntry = nextEntry;
        if (fallbackEntry) {
          setWatchProgress((current) => ({
            ...current,
            [videoId]: fallbackEntry,
          }));
        }
      });
  }

  function resumePlayback(video: FeedVideo, player: HTMLVideoElement) {
    const videoId = video.id;
    const progress = watchProgress[videoId];
    if (!progress || progress.currentTime < 5) return;
    const duration = playerProgressDuration(video, player) || progress.duration;
    if (progress.currentTime < duration - 8) {
      try {
        player.currentTime = Math.max(
          0,
          progress.currentTime - watchResumeRewindSeconds
        );
      } catch {
        // Some mobile players reject seeking until enough metadata is available.
      }
    }
  }

  function progressPercent(videoId: string) {
    if (unwatchedVideoIds.includes(videoId)) return undefined;
    if (watchedVideoIds.includes(videoId)) return 100;
    const progress = watchProgress[videoId];
    if (!progress?.duration) return undefined;
    return Math.max(2, Math.min(98, (progress.currentTime / progress.duration) * 100));
  }

  async function removeDownload(video: FeedVideo) {
    setDeleteState("deleting");
    setDeleteError("");
    try {
      const response = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id }),
      });
      const data = (await response.json()) as { error?: string; demo?: boolean };
      if (!response.ok) throw new Error(data.error || copy.errors.deleteDownload);
      markVideoDeleted(video.id);
      setDeleteState("idle");
      const refreshes = [loadFeed(true, true)];
      if (view === "local") {
        refreshes.push(loadLocalVideos(true, true));
      }
      if (view === "singles") {
        refreshes.push(loadSingleVideos(true));
      }
      await Promise.allSettled(refreshes);
    } catch (deleteFailure) {
      setDeleteState("error");
      setDeleteError(
        deleteFailure instanceof Error
          ? deleteFailure.message
          : copy.errors.deleteDownload
      );
    }
  }

  async function submitChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = channelUrl.trim();
    if (!url) return;
    setAddChannelState("adding");
    setAddChannelMessage("");
    try {
      const response = await fetch("/api/channels/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json()) as {
        error?: string;
        channel?: { name?: string; restored?: boolean };
      };
      if (!response.ok) throw new Error(data.error || copy.errors.addChannel);
      setChannelUrl("");
      setAddChannelState("added");
      setAddChannelMessage(
        data.channel?.restored
          ? copy.channels.restored(data.channel.name || copy.channels.title)
          : copy.channels.added(data.channel?.name || copy.channels.title)
      );
      void loadFeed(true, true);
    } catch (addFailure) {
      setAddChannelState("error");
      setAddChannelMessage(
        addFailure instanceof Error
          ? addFailure.message
          : copy.errors.addChannel
      );
    }
  }

  async function submitSingleVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = singleVideoUrl.trim();
    if (!url) return;
    setSingleVideoState("adding");
    setSingleVideoMessage("");
    try {
      const response = await fetch("/api/single-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json()) as {
        error?: string;
        video?: FeedVideo;
      };
      if (!response.ok) {
        throw new Error(data.error || copy.errors.addSingle);
      }
      setSingleVideoUrl("");
      setSingleVideoState("added");
      setSingleVideoMessage(copy.singles.added(data.video?.title || "Video"));
      void loadSingleVideos(true);
    } catch (addFailure) {
      setSingleVideoState("error");
      setSingleVideoMessage(
        addFailure instanceof Error
          ? addFailure.message
          : copy.errors.addSingle
      );
    }
  }

  async function removeSingleVideo(video: FeedVideo) {
    try {
      const response = await fetch("/api/single-videos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id }),
      });
      const data = (await response.json()) as {
        videos?: FeedVideo[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || copy.errors.removeSingle);
      }
      setSingleVideos(data.videos || []);
      setWatchProgress((current) => {
        const next = { ...current };
        delete next[video.id];
        return next;
      });
      if (selectedVideo?.id === video.id) {
        setSelectedVideo(null);
      }
    } catch (removeFailure) {
      setError(
        removeFailure instanceof Error
          ? removeFailure.message
          : copy.errors.removeSingle
      );
    }
  }

  function refreshCurrentView() {
    if (view === "floatplane") {
      void loadFloatplaneVideos(true, true);
      return;
    }
    if (view === "local") {
      void loadLocalVideos(true, true);
      return;
    }
    if (view === "singles") {
      void loadSingleVideos(true);
      return;
    }
    void loadFeed(true, true);
  }

  function switchView(next: View) {
    setView(next);
    setSelectedChannel(null);
    setChannelVideos([]);
    setFilter("all");
    if (next !== "floatplane") setFloatplaneCreatorFilter("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeActivity =
    status?.mode === "live" && activity && activity.state !== "idle"
      ? activity
      : null;
  const selectedVideoId = selectedVideo
    ? encodeURIComponent(selectedVideo.id)
    : "";
  const playerSource = selectedVideo
    ? selectedVideo.provider === "floatplane"
      ? `/api/floatplane/stream/${selectedVideoId}`
      : `/api/stream/${selectedVideoId}`
    : "";
  const selectedVideoPlayable =
    Boolean(selectedVideo?.downloaded) &&
    (mode === "live" || selectedVideo?.provider === "floatplane");
  const inlineWatchPage = selectedVideo ? shouldUseInlineWatchPage() : false;
  const selectedDescription = selectedVideo
    ? videoMetadata[selectedVideo.id]?.description?.trim() ||
      selectedVideo.description?.trim() ||
      ""
    : "";
  const descriptionExpanded = selectedVideo
    ? expandedDescriptions[selectedVideo.id] === true
    : false;
  const descriptionCanCollapse =
    selectedDescription.length > 110 ||
    selectedDescription.split(/\r?\n/).filter(Boolean).length > 2;
  const selectedLikeCount = selectedVideo
    ? videoMetadata[selectedVideo.id]?.likeCount
    : null;

  return (
    <div className={`app-shell ${selectedVideo ? "has-player" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => switchView("feed")}>
          <span className="brand-mark">
            <FontAwesomeIcon icon={faCirclePlay} aria-hidden="true" />
          </span>
          <span>Youtarr</span>
        </button>
        <div className={`search-wrap ${searchOpen ? "search-open" : ""}`}>
          <FontAwesomeIcon
            className="search-icon"
            icon={faMagnifyingGlass}
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search.placeholder}
            aria-label={copy.search.aria}
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label={copy.search.clear}>
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="top-actions">
          <button
            className="round-button mobile-search"
            onClick={() => setSearchOpen((open) => !open)}
            aria-label={copy.search.button}
          >
            <FontAwesomeIcon
              className="search-icon"
              icon={faMagnifyingGlass}
              aria-hidden="true"
            />
          </button>
          <button
            className={`round-button refresh-button ${refreshing ? "spinning" : ""}`}
            onClick={refreshCurrentView}
            aria-label={copy.common.refresh}
          >
            <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
          </button>
          <button
            className="profile-button"
            onClick={() => setSettingsOpen(true)}
            aria-label={copy.settings.buttonAria}
          >
            NF
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <nav aria-label={copy.nav.feed}>
          <button
            className={view === "feed" ? "active" : ""}
            onClick={() => switchView("feed")}
          >
            <NavIcon view="feed" />
            <span>{copy.nav.feed}</span>
          </button>
          <button
            className={view === "continue" ? "active" : ""}
            onClick={() => switchView("continue")}
          >
            <NavIcon view="continue" />
            <span>{copy.nav.continueFull}</span>
          </button>
          <button
            className={view === "local" ? "active" : ""}
            onClick={() => switchView("local")}
          >
            <NavIcon view="local" />
            <span>{copy.nav.local}</span>
          </button>
          <button
            className={view === "singles" ? "active" : ""}
            onClick={() => switchView("singles")}
          >
            <NavIcon view="singles" />
            <span>{copy.nav.singles}</span>
          </button>
          <button
            className={view === "floatplane" ? "active" : ""}
            onClick={() => switchView("floatplane")}
          >
            <NavIcon view="floatplane" />
            <span>{copy.nav.floatplane}</span>
          </button>
          <button
            className={view === "channels" ? "active" : ""}
            onClick={() => switchView("channels")}
          >
            <NavIcon view="channels" />
            <span>{copy.nav.channels}</span>
          </button>
        </nav>
        <div className="sidebar-status">
          <span className={`status-dot status-${mode}`} />
          <div>
            <strong>{status?.connected ? copy.common.connected : copy.common.demo}</strong>
            <small>{status?.server || copy.common.notConfigured}</small>
          </div>
        </div>
      </aside>

      <main>
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => void loadFeed()}>{copy.common.retry}</button>
          </div>
        )}

        {activeActivity && (
          <section className={`activity-strip activity-${activeActivity.state}`}>
            <div>
              <strong>{activeActivity.label}</strong>
              <span>{formatEta(activeActivity.etaSeconds, copy) || copy.activityFallback}</span>
            </div>
            <div className="activity-meter" aria-label={copy.thumbnail.downloadingAria}>
              <span style={{ width: `${activeActivity.percent}%` }} />
            </div>
          </section>
        )}

        {view === "feed" && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">
                  <span className={`status-dot status-${mode}`} />
                  {mode === "live" ? copy.feed.eyebrowLive : copy.feed.eyebrowDemo}
                </span>
                <h1>{copy.feed.title}</h1>
                <p>{copy.feed.subtitle}</p>
              </div>
              <button className="settings-link" onClick={() => setSettingsOpen(true)}>
                {copy.common.settings}
              </button>
            </section>
            <div className="filter-row" role="group" aria-label={copy.feed.title}>
              {[
                ["all", copy.feed.all],
                ["new", copy.feed.new],
                ["downloaded", copy.feed.downloaded],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value as Filter)}
                >
                  {label}
                </button>
              ))}
            </div>
            {loading ? (
              <LoadingGrid copy={copy} />
            ) : visibleVideos.length ? (
              <div className="video-grid">
                {visibleVideos.map((video, index) => (
                  <VideoCard
                    key={`${video.channelId}-${video.id}`}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    streamSource={streamSources[video.id]}
                    downloadJob={downloadJobs[video.id]}
                    onOpen={openVideo}
                    onChannel={(id) => void openChannel(id)}
                    onDelete={(item) => void removeDownload(item)}
                    onRedownload={(item) => void startDownload(item, true)}
                    onMarkWatched={(item) => void setVideoWatched(item, true)}
                    onMarkUnwatched={(item) => void setVideoWatched(item, false)}
                    isWatched={isVideoWatched(video)}
                    copy={copy}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark">
                  <FontAwesomeIcon icon={faInbox} aria-hidden="true" />
                </span>
                <h2>{copy.feed.emptyTitle}</h2>
                <p>{copy.feed.emptyBody}</p>
              </div>
            )}
          </>
        )}

        {view === "continue" && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">{copy.continue.eyebrow}</span>
                <h1>{copy.continue.title}</h1>
                <p>{copy.continue.subtitle}</p>
              </div>
            </section>
            {loading ? (
              <LoadingGrid copy={copy} />
            ) : continueVideos.length ? (
              <div className="video-grid">
                {continueVideos.map((video, index) => (
                  <VideoCard
                    key={`${video.channelId}-${video.id}`}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    streamSource={streamSources[video.id]}
                    downloadJob={downloadJobs[video.id]}
                    onOpen={openVideo}
                    onChannel={(id) => void openChannel(id)}
                    onDelete={(item) => void removeDownload(item)}
                    onRedownload={(item) => void startDownload(item, true)}
                    onMarkWatched={(item) => void setVideoWatched(item, true)}
                    onMarkUnwatched={(item) => void setVideoWatched(item, false)}
                    isWatched={isVideoWatched(video)}
                    copy={copy}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark">
                  <FontAwesomeIcon icon={faInbox} aria-hidden="true" />
                </span>
                <h2>{copy.continue.emptyTitle}</h2>
                <p>{copy.continue.emptyBody}</p>
              </div>
            )}
          </>
        )}

        {view === "local" && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">{copy.local.eyebrow}</span>
                <h1>{copy.local.title}</h1>
                <p>{copy.local.subtitle}</p>
              </div>
              <button
                className="settings-link"
                onClick={() => void loadLocalVideos(true, true)}
              >
                {copy.common.refresh}
              </button>
            </section>
            {localLoading ? (
              <LoadingGrid copy={copy} />
            ) : filteredLocalVideos.length ? (
              <div className="video-grid">
                {filteredLocalVideos.map((video, index) => (
                  <VideoCard
                    key={`${video.channelId}-${video.id}`}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    streamSource={streamSources[video.id]}
                    downloadJob={downloadJobs[video.id]}
                    onOpen={openVideo}
                    onChannel={(id) => void openChannel(id)}
                    onDelete={(item) => void removeDownload(item)}
                    onRedownload={(item) => void startDownload(item, true)}
                    onMarkWatched={(item) => void setVideoWatched(item, true)}
                    onMarkUnwatched={(item) => void setVideoWatched(item, false)}
                    isWatched={isVideoWatched(video)}
                    copy={copy}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark">
                  <FontAwesomeIcon icon={faInbox} aria-hidden="true" />
                </span>
                <h2>{copy.local.emptyTitle}</h2>
                <p>{copy.local.emptyBody}</p>
              </div>
            )}
          </>
        )}

        {view === "singles" && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">{copy.singles.eyebrow}</span>
                <h1>{copy.singles.title}</h1>
                <p>{copy.singles.subtitle}</p>
              </div>
              <button
                className="settings-link"
                onClick={() => void loadSingleVideos(true)}
              >
                {copy.common.refresh}
              </button>
            </section>
            <form className="add-video-form" onSubmit={submitSingleVideo}>
              <input
                value={singleVideoUrl}
                onChange={(event) => setSingleVideoUrl(event.target.value)}
                placeholder={copy.singles.placeholder}
                aria-label={copy.singles.aria}
              />
              <button
                className="primary-button"
                disabled={singleVideoState === "adding"}
              >
                {singleVideoState === "adding" ? copy.common.adding : copy.common.add}
              </button>
              {singleVideoMessage && (
                <span className={`form-message form-${singleVideoState}`}>
                  {singleVideoMessage}
                </span>
              )}
            </form>
            {singleLoading ? (
              <LoadingGrid copy={copy} />
            ) : filteredSingleVideos.length ? (
              <div className="video-grid">
                {filteredSingleVideos.map((video, index) => (
                  <VideoCard
                    key={`single-${video.id}`}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    streamSource={streamSources[video.id]}
                    downloadJob={downloadJobs[video.id]}
                    onOpen={openVideo}
                    onDelete={(item) => void removeDownload(item)}
                    onRedownload={(item) => void startDownload(item, true)}
                    onRemoveFromList={(item) => void removeSingleVideo(item)}
                    onMarkWatched={(item) => void setVideoWatched(item, true)}
                    onMarkUnwatched={(item) => void setVideoWatched(item, false)}
                    isWatched={isVideoWatched(video)}
                    copy={copy}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark">
                  <FontAwesomeIcon icon={faInbox} aria-hidden="true" />
                </span>
                <h2>{copy.singles.emptyTitle}</h2>
                <p>{copy.singles.emptyBody}</p>
              </div>
            )}
          </>
        )}

        {view === "floatplane" && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">{copy.floatplane.eyebrow}</span>
                <h1>{copy.floatplane.title}</h1>
                <p>{copy.floatplane.subtitle}</p>
              </div>
              <button
                className="settings-link"
                onClick={() => void loadFloatplaneVideos(true, true)}
              >
                {copy.common.refresh}
              </button>
            </section>
            {floatplaneCreators.length > 1 && (
              <div className="filter-row" role="group" aria-label={copy.floatplane.title}>
                <button
                  className={floatplaneCreatorFilter === "all" ? "active" : ""}
                  onClick={() => setFloatplaneCreatorFilter("all")}
                >
                  {copy.floatplane.allChannels}
                </button>
                {floatplaneCreators.map((creator) => (
                  <button
                    key={creator.id}
                    className={floatplaneCreatorFilter === creator.id ? "active" : ""}
                    onClick={() => setFloatplaneCreatorFilter(creator.id)}
                  >
                    {creator.name}
                  </button>
                ))}
              </div>
            )}
            {floatplaneLoading && !floatplaneVideos.length ? (
              <LoadingGrid copy={copy} />
            ) : filteredFloatplaneVideos.length ? (
              <div className="video-grid">
                {filteredFloatplaneVideos.map((video, index) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    downloadJob={downloadJobs[video.id]}
                    onOpen={openVideo}
                    onMarkWatched={(item) => void setVideoWatched(item, true)}
                    onMarkUnwatched={(item) => void setVideoWatched(item, false)}
                    isWatched={isVideoWatched(video)}
                    copy={copy}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark">
                  <FontAwesomeIcon icon={faInbox} aria-hidden="true" />
                </span>
                <h2>{copy.floatplane.emptyTitle}</h2>
                <p>{copy.floatplane.emptyBody}</p>
              </div>
            )}
            {!floatplaneLoading && floatplaneHasMore && (
              <div
                ref={floatplaneLoadMoreRef}
                className="load-more-sentinel"
              >
                <button
                  className="load-more-button"
                  onClick={() => void loadFloatplaneVideos(true, false, true)}
                  disabled={floatplaneLoadingMore}
                >
                  <FontAwesomeIcon
                    className={floatplaneLoadingMore ? "spinning" : ""}
                    icon={faRotateRight}
                    aria-hidden="true"
                  />
                  {floatplaneLoadingMore
                    ? copy.floatplane.loadingMore
                    : copy.floatplane.loadMore}
                </button>
              </div>
            )}
          </>
        )}

        {view === "channels" && !selectedChannel && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">{copy.channels.eyebrow}</span>
                <h1>{copy.channels.title}</h1>
                <p>{copy.channels.subscriptions(feed?.channels.length || 0)}</p>
              </div>
              <ChannelExportLink copy={copy} />
            </section>
            <form className="add-channel-form" onSubmit={submitChannel}>
              <input
                value={channelUrl}
                onChange={(event) => setChannelUrl(event.target.value)}
                placeholder={copy.channels.placeholder}
                aria-label={copy.channels.aria}
              />
              <button
                className="primary-button"
                disabled={addChannelState === "adding" || mode !== "live"}
              >
                {addChannelState === "adding" ? copy.common.adding : copy.common.add}
              </button>
              {addChannelMessage && (
                <span className={`form-message form-${addChannelState}`}>
                  {addChannelMessage}
                </span>
              )}
            </form>
            {loading ? (
              <LoadingGrid copy={copy} />
            ) : (
              <div className="channel-grid">
                {(feed?.channels || []).map((channel) => (
                  <button
                    className="channel-card"
                    key={channel.id}
                    onClick={() => void openChannel(channel.id)}
                  >
                    <ChannelAvatar channel={channel} size="large" />
                    <span className="channel-card-copy">
                      <strong>{channel.name}</strong>
                      <small>
                        {channel.autoDownload
                          ? copy.channels.autoDownload
                          : copy.channels.downloadOnOpen}
                      </small>
                    </span>
                    <FontAwesomeIcon
                      className="chevron"
                      icon={faChevronRight}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {view === "channels" && selectedChannel && (
          <>
            <button
              className="back-button"
              onClick={() => {
                setSelectedChannel(null);
                setChannelVideos([]);
              }}
            >
              <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" /> {copy.channels.back}
            </button>
            <section className="channel-hero">
              <ChannelAvatar channel={selectedChannel} size="large" />
              <div>
                <span className="eyebrow">{copy.channels.channelEyebrow}</span>
                <h1>{selectedChannel.name}</h1>
                <p>
                  {selectedChannel.autoDownload
                    ? copy.channels.autoDownloadHint
                    : copy.channels.manualDownloadHint}
                </p>
              </div>
              <ChannelExportLink copy={copy} />
            </section>
            <div className="filter-row" role="group" aria-label={copy.feed.title}>
              {[
                ["all", copy.feed.all],
                ["new", copy.feed.new],
                ["downloaded", copy.feed.downloaded],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value as Filter)}
                >
                  {label}
                </button>
              ))}
            </div>
            {channelLoading ? (
              <LoadingGrid copy={copy} />
            ) : (
              <div className="video-grid">
                {visibleVideos.map((video, index) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    streamSource={streamSources[video.id]}
                    downloadJob={downloadJobs[video.id]}
                    onOpen={openVideo}
                    onChannel={() => undefined}
                    onDelete={(item) => void removeDownload(item)}
                    onRedownload={(item) => void startDownload(item, true)}
                    onMarkWatched={(item) => void setVideoWatched(item, true)}
                    onMarkUnwatched={(item) => void setVideoWatched(item, false)}
                    isWatched={isVideoWatched(video)}
                    copy={copy}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <nav className="bottom-nav" aria-label={copy.nav.feed}>
        <button
          className={view === "feed" ? "active" : ""}
          onClick={() => switchView("feed")}
        >
          <NavIcon view="feed" />
          <small>{copy.nav.feed}</small>
        </button>
        <button
          className={view === "continue" ? "active" : ""}
          onClick={() => switchView("continue")}
        >
          <NavIcon view="continue" />
          <small>{copy.nav.continue}</small>
        </button>
        <button
          className={view === "local" ? "active" : ""}
          onClick={() => switchView("local")}
        >
          <NavIcon view="local" />
          <small>{copy.nav.local}</small>
        </button>
        <button
          className={view === "singles" ? "active" : ""}
          onClick={() => switchView("singles")}
        >
          <NavIcon view="singles" />
          <small>{copy.nav.singlesShort}</small>
        </button>
        <button
          className={view === "floatplane" ? "active" : ""}
          onClick={() => switchView("floatplane")}
        >
          <NavIcon view="floatplane" />
          <small>{copy.nav.floatplaneShort}</small>
        </button>
        <button
          className={view === "channels" ? "active" : ""}
          onClick={() => switchView("channels")}
        >
          <NavIcon view="channels" />
          <small>{copy.nav.channels}</small>
        </button>
      </nav>

      <div className="orientation-guard" role="status" aria-live="polite">
        <div>
          <FontAwesomeIcon
            className="orientation-mark"
            icon={faMobileScreenButton}
            aria-hidden="true"
          />
          <strong>{copy.orientation.title}</strong>
          <p>{copy.orientation.body}</p>
        </div>
      </div>

      {selectedVideo && (
        <div
          className={
            playerMode === "mini"
              ? "mini-player-shell"
              : `modal-backdrop player-backdrop ${
                  inlineWatchPage ? "watch-page-backdrop" : ""
                }`
          }
          role="presentation"
          onMouseDown={(event) => {
            if (playerMode === "mini") {
              setPlayerMode("full");
              return;
            }
            if (event.currentTarget === event.target) {
              closePlayer();
            }
          }}
        >
          <section
            className={
              playerMode === "mini"
                ? "video-modal video-modal-mini"
                : `video-modal ${inlineWatchPage ? "video-modal-watch-page" : ""}`
            }
            role="dialog"
            aria-modal="true"
            aria-label={selectedVideo.title}
          >
            {playerMode === "mini" ? (
              <button
                className="modal-close modal-close-x"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={closePlayer}
                aria-label={copy.common.close}
              >
                <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
              </button>
            ) : (
              <div
                className="player-actions"
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  className="player-action-button"
                  onClick={closePlayer}
                  aria-label={copy.common.minimize}
                >
                  <FontAwesomeIcon icon={faMinus} aria-hidden="true" />
                </button>
                {selectedVideoPlayable && (
                  <button
                    className="player-action-button"
                    onClick={requestPlayerFullscreen}
                    aria-label={copy.common.fullscreen}
                  >
                    <FontAwesomeIcon icon={faExpand} aria-hidden="true" />
                  </button>
                )}
                {standaloneMode && selectedVideoPlayable && (
                  <button
                    className="player-action-button"
                    onClick={() => {
                      if (playerRef.current) {
                        void requestManualPictureInPicture(playerRef.current);
                      }
                    }}
                    aria-label={copy.player.pip}
                  >
                    <FontAwesomeIcon icon={faClone} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            {selectedVideoPlayable ? (
              <>
                <div
                  className="player-frame"
                  onPointerDown={handlePlayerDragStart}
                  onPointerMove={handlePlayerDragMove}
                  onPointerUp={handlePlayerDragEnd}
                  onPointerCancel={() => {
                    playerDragRef.current = null;
                  }}
                >
                  <video
                    ref={playerRef}
                    className="player"
                    controls={playerMode === "full"}
                    autoPlay
                    playsInline
                    disableRemotePlayback={false}
                    preload="metadata"
                    poster={selectedVideo.thumbnail || undefined}
                    src={playerSource}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.setAttribute("x-webkit-airplay", "allow");
                      event.currentTarget.setAttribute("webkit-playsinline", "true");
                      updateMediaSession(selectedVideo);
                      updateMediaSessionControls(event.currentTarget);
                      resumePlayback(selectedVideo, event.currentTarget);
                      if (playerMode === "full" && !inlineWatchPage) {
                        void requestNativeFullscreen(event.currentTarget);
                      }
                    }}
                    onPlay={(event) => {
                      if (pauseIntentTimerRef.current) {
                        window.clearTimeout(pauseIntentTimerRef.current);
                        pauseIntentTimerRef.current = null;
                      }
                      intendedPlaybackRef.current = true;
                      setPlayerPlaying(true);
                      updateMediaSession(selectedVideo);
                      updateMediaSessionControls(event.currentTarget);
                      if ("mediaSession" in navigator) {
                        navigator.mediaSession.playbackState = "playing";
                      }
                      if (playerMode === "full" && !inlineWatchPage) {
                        void requestNativeFullscreen(event.currentTarget);
                      }
                    }}
                    onTimeUpdate={(event) =>
                      storePlayerWatchProgress(selectedVideo, event.currentTarget)
                    }
                    onPause={(event) => {
                      if (pauseIntentTimerRef.current) {
                        window.clearTimeout(pauseIntentTimerRef.current);
                      }
                      pauseIntentTimerRef.current = window.setTimeout(() => {
                        intendedPlaybackRef.current = false;
                        pauseIntentTimerRef.current = null;
                      }, 350);
                      setPlayerPlaying(false);
                      if ("mediaSession" in navigator) {
                        navigator.mediaSession.playbackState = "paused";
                      }
                      storePlayerWatchProgress(selectedVideo, event.currentTarget, true);
                    }}
                    onEnded={(event) => {
                      intendedPlaybackRef.current = false;
                      setPlayerPlaying(false);
                      storeWatchProgress(
                        selectedVideo.id,
                        playerProgressDuration(selectedVideo, event.currentTarget),
                        playerProgressDuration(selectedVideo, event.currentTarget),
                        true,
                        selectedVideo.thumbnail
                      );
                    }}
                    onError={(event) => {
                      intendedPlaybackRef.current =
                        intendedPlaybackRef.current || !event.currentTarget.paused;
                      const fallbackSource: StreamSourceInfo = {
                        source:
                          selectedVideo.provider === "floatplane"
                            ? "floatplane"
                            : "youtarr",
                        playbackProfile: streamSource?.playbackProfile,
                        playbackLabel: streamSource?.playbackLabel,
                        local: streamSource?.local,
                        youtarrConfigured: streamSource?.youtarrConfigured ?? true,
                      };
                      setStreamSource(fallbackSource);
                      setStreamSources((current) => ({
                        ...current,
                        [selectedVideo.id]: fallbackSource,
                      }));
                    }}
                  />
                </div>
                {playerMode === "mini" && (
                  <div
                    className="mini-player-controls"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      className="mini-play-button"
                      onClick={toggleMiniPlayback}
                      aria-label={playerPlaying ? copy.common.pause : copy.common.play}
                    >
                      {playerPlaying ? (
                        <FontAwesomeIcon icon={faPause} aria-hidden="true" />
                      ) : (
                        <FontAwesomeIcon icon={faPlay} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                )}
              </>
            ) : selectedVideo.downloaded ? (
              <div className="demo-player">
                <span className="demo-play">
                  <FontAwesomeIcon icon={faPlay} aria-hidden="true" />
                </span>
                <p>{copy.player.demoBody}</p>
              </div>
            ) : (
              <div className="download-panel">
                <div className="download-orbit">
                  <FontAwesomeIcon icon={faDownload} aria-hidden="true" />
                </div>
                <span className="eyebrow">{copy.player.notLocalEyebrow}</span>
                <h2>{copy.player.notLocalTitle}</h2>
                <p>{copy.player.notLocalBody}</p>
              </div>
            )}
            <div className="modal-copy">
              <h2>{selectedVideo.title}</h2>
              <button
                disabled={selectedVideo.provider === "floatplane"}
                onClick={() => {
                  if (selectedVideo.provider === "floatplane") return;
                  const id = selectedVideo.channelId;
                  setSelectedVideo(null);
                  void openChannel(id);
                }}
              >
                {selectedVideo.channelName}
              </button>
              <div className="watch-meta">
                <span>{relativeDate(selectedVideo.publishedAt, copy)}</span>
                {typeof selectedLikeCount === "number" && selectedLikeCount > 0 && (
                  <span className="watch-like-count">
                    <FontAwesomeIcon icon={faThumbsUp} aria-hidden="true" />
                    {formatCompactNumber(selectedLikeCount, copy)}
                  </span>
                )}
              </div>
              {selectedDescription && (
                <div
                  className={`watch-description ${
                    descriptionExpanded ? "watch-description-expanded" : ""
                  }`}
                >
                  <p>{selectedDescription}</p>
                  {descriptionCanCollapse && (
                    <button
                      type="button"
                      className="watch-description-toggle"
                      onClick={() => {
                        setExpandedDescriptions((current) => ({
                          ...current,
                          [selectedVideo.id]: !descriptionExpanded,
                        }));
                      }}
                    >
                      {descriptionExpanded
                        ? copy.player.descriptionShowLess
                        : copy.player.descriptionShowMore}
                    </button>
                  )}
                </div>
              )}
              {selectedVideoPlayable && (
                <p
                  className={`stream-source stream-source-${streamSource?.source || "unknown"}`}
                >
                  <strong>
                    {streamSource?.source === "floatplane"
                      ? "Floatplane"
                      : streamSource?.source === "local"
                      ? copy.player.sourceDirect
                      : streamSource?.source === "youtarr"
                        ? copy.player.sourceYoutarr
                        : copy.player.sourceChecking}
                  </strong>
                  {streamSource?.source === "floatplane"
                    ? copy.floatplane.sourceBody(
                        [
                          streamSource.stream?.label,
                          streamSource.stream?.codec,
                          streamSource.stream?.height
                            ? `${streamSource.stream.height}p`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      )
                    : streamSource?.source === "local" && streamSource.local?.fileName
                    ? copy.player.sourceDirectBody(streamSource.local.fileName)
                    : streamSource?.local?.configured === false
                      ? copy.player.sourceNoMount
                      : streamSource?.source === "youtarr"
                        ? copy.player.sourceFallback
                        : copy.player.sourceCheckingBody}
                  {streamSource?.source === "youtarr" &&
                    streamSource.local?.debug?.reason === "file_not_found" &&
                    streamSource.local.debug.expectedFilePath && (
                      <small>
                        {copy.player.sourceExpectedPath(
                          streamSource.local.debug.expectedFilePath,
                          streamSource.local.debug.sourceMediaDirectory || "",
                          streamSource.local.debug.mediaDirectory || ""
                        )}
                      </small>
                    )}
                </p>
              )}
              {selectedVideoPlayable && (
                <div className="modal-actions">
                  <button
                    className="icon-secondary-button"
                    onClick={() =>
                      void setVideoWatched(selectedVideo, !isVideoWatched(selectedVideo))
                    }
                    title={
                      isVideoWatched(selectedVideo)
                        ? copy.common.markUnwatched
                        : copy.common.markWatched
                    }
                    aria-label={
                      isVideoWatched(selectedVideo)
                        ? copy.common.markUnwatched
                        : copy.common.markWatched
                    }
                  >
                    <FontAwesomeIcon
                      icon={isVideoWatched(selectedVideo) ? faClockRotateLeft : faCheck}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    className="icon-secondary-button"
                    onClick={() => openSelectedVideoInVlc(selectedVideo)}
                    title={copy.player.openInVlc}
                    aria-label={copy.player.openInVlc}
                  >
                    <FontAwesomeIcon icon={faUpRightFromSquare} aria-hidden="true" />
                  </button>
                  {selectedVideo.provider !== "floatplane" && (
                    <button
                      className="icon-danger-button"
                      onClick={() => {
                        if (window.confirm(copy.player.confirmDelete(selectedVideo.title))) {
                          void removeDownload(selectedVideo);
                        }
                      }}
                      disabled={deleteState === "deleting"}
                      title={copy.common.deleteDownload}
                      aria-label={copy.common.deleteDownload}
                    >
                      <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                    </button>
                  )}
                  {deleteState === "error" && <small>{deleteError}</small>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSettingsOpen(false);
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={copy.settings.aria}
          >
            <button
              className="modal-close"
              onClick={() => setSettingsOpen(false)}
              aria-label={copy.common.close}
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
            <span className={`connection-icon connection-${mode}`}>
              <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
            </span>
            <span className="eyebrow">{copy.settings.eyebrow}</span>
            <h2>
              {status?.connected
                ? copy.settings.connectedTitle
                : copy.settings.demoTitle}
            </h2>
            <p>
              {status?.connected
                ? copy.settings.connectedBody(status.server || "Youtarr")
                : copy.settings.demoBody}
            </p>
            <div className="settings-facts">
              <div>
                <span>{copy.settings.feedLabel}</span>
                <strong>{copy.settings.feedValue}</strong>
              </div>
              <div>
                <span>{copy.settings.plexLabel}</span>
                <strong>
                  {status?.plexConfigured
                    ? copy.settings.plexEnabled
                    : copy.settings.plexDisabled}
                </strong>
              </div>
              <div>
                <span>{copy.settings.downloadLabel}</span>
                <strong>{copy.settings.downloadValue}</strong>
              </div>
              <div>
                <span>{copy.settings.languageLabel}</span>
                <strong className="language-switcher">
                  {languageOptions.map((option) => (
                    <button
                      key={option.code}
                      className={language === option.code ? "active" : ""}
                      onClick={() => setLanguage(option.code)}
                    >
                      {option.label}
                    </button>
                  ))}
                </strong>
              </div>
            </div>
            {status?.diagnostics && (
              <div className="settings-diagnostics">
                <div className="settings-diagnostics-heading">
                  <div>
                    <span className="eyebrow">{copy.settings.diagnosticsEyebrow}</span>
                    <h3>{copy.settings.diagnosticsTitle}</h3>
                  </div>
                  <button
                    className={`settings-check-button ${
                      settingsChecking ? "spinning" : ""
                    }`}
                    onClick={() => void refreshStatus()}
                    disabled={settingsChecking}
                  >
                    <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
                    {settingsChecking
                      ? copy.settings.checkingConnections
                      : copy.settings.checkConnections}
                  </button>
                </div>
                <form
                  className="floatplane-session-form"
                  onSubmit={submitFloatplaneSessionToken}
                >
                  <label htmlFor="floatplane-session-token">
                    {copy.settings.floatplaneSessionTitle}
                  </label>
                  <p>{copy.settings.floatplaneSessionBody}</p>
                  <div className="floatplane-session-row">
                    <input
                      id="floatplane-session-token"
                      type="password"
                      value={floatplaneSessionToken}
                      onChange={(event) => {
                        setFloatplaneSessionToken(event.target.value);
                        if (floatplaneSessionState !== "idle") {
                          setFloatplaneSessionState("idle");
                          setFloatplaneSessionMessage("");
                        }
                      }}
                      placeholder={copy.settings.floatplaneSessionPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      className="settings-check-button"
                      type="submit"
                      disabled={floatplaneSessionState === "saving"}
                    >
                      {floatplaneSessionState === "saving"
                        ? copy.settings.floatplaneSessionSaving
                        : copy.settings.floatplaneSessionSave}
                    </button>
                  </div>
                  {floatplaneSessionMessage && (
                    <small
                      className={`floatplane-session-message ${
                        floatplaneSessionState === "error" ? "error" : "success"
                      }`}
                    >
                      {floatplaneSessionMessage}
                    </small>
                  )}
                </form>
                <div className="playback-routing">
                  <div>
                    <span>{copy.settings.playbackProfileLabel}</span>
                    <strong>{status.diagnostics.youtarr.playbackProfile}</strong>
                  </div>
                  <div>
                    <span>{copy.settings.ipadMacSafariLabel}</span>
                    <strong>
                      {status.diagnostics.youtarr.effectiveProfiles.ipadMacSafari}
                    </strong>
                  </div>
                  <div>
                    <span>{copy.settings.iphoneLabel}</span>
                    <strong>{status.diagnostics.youtarr.effectiveProfiles.iphone}</strong>
                  </div>
                  <div>
                    <span>{copy.settings.fallbackLabel}</span>
                    <strong>{status.diagnostics.youtarr.effectiveProfiles.fallback}</strong>
                  </div>
                </div>
                <div className="diagnostic-grid">
                  {status.diagnostics.youtarr.instances.map((diagnostic) => (
                    <DiagnosticCard
                      key={diagnostic.key}
                      diagnostic={diagnostic}
                      copy={copy}
                    />
                  ))}
                  <DiagnosticCard diagnostic={status.diagnostics.plex} copy={copy} />
                  <DiagnosticCard
                    diagnostic={status.diagnostics.floatplane}
                    copy={copy}
                  />
                </div>
              </div>
            )}
            <button className="primary-button" onClick={() => setSettingsOpen(false)}>
              {copy.common.done}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
