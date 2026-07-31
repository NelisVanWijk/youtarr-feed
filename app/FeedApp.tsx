"use client";

import {
  faCheck,
  faChevronLeft,
  faChevronRight,
  faBolt,
  faCirclePlay,
  faClockRotateLeft,
  faClone,
  faDownload,
  faEllipsisVertical,
  faFilm,
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
  faRotateRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
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
  WatchProgressEntry,
  WatchProgressMap,
} from "../lib/types";

type View = "feed" | "continue" | "local" | "singles" | "channels";
type Filter = "all" | "new" | "downloaded";
type PlayerMode = "full" | "mini";
type PlayerStreamMode = "direct" | "youtarr" | "compatible";
type PlayerQuality = "auto" | "original" | "1080";
type WebKitVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: "fullscreen" | "inline" | "picture-in-picture") => void;
  webkitSupportsPresentationMode?: (mode: "picture-in-picture") => boolean;
};
type StreamSourceInfo = {
  source: "local" | "youtarr";
  local?: {
    configured: boolean;
    available: boolean;
    fileName?: string;
    extension?: string;
    size?: number;
    compatible?: boolean;
    quality?: "original" | "1080";
    variants?: Array<{
      quality: "original" | "1080";
      label: string;
      fileName: string;
      size: number;
      extension: string;
      compatible: boolean;
      height?: number;
    }>;
  };
  transcode?: {
    enabled: boolean;
    configured: boolean;
    available: boolean;
    ready: boolean;
    complete: boolean;
    running: boolean;
    startTime: number;
    outputMode: "file" | "hls";
    playbackMode: "vod" | "fast";
    mediaUrl?: string;
    playlistUrl?: string;
    error?: string;
  };
  youtarrConfigured: boolean;
};
type TranscodeResponse = StreamSourceInfo["transcode"] & {
  appleDecision?: {
    suggested: boolean;
    reason?: string;
    videoCodec?: string;
    audioCodec?: string;
  };
};
type DownloadJob = {
  state: "queueing" | "queued" | "error";
  channelId: string;
  error?: string;
};

const palette = ["coral", "blue", "lime", "violet", "gold"];
const languageStorageKey = "youtarr-feed-language";
const qualityStorageKey = "youtarr-feed-quality";

function isPlayerQuality(value: string | null): value is PlayerQuality {
  return value === "auto" || value === "original" || value === "1080";
}

function isApplePlaybackUserAgent(value: string) {
  return /\b(iPhone|iPad|iPod)\b/i.test(value) || (
    /\bMacintosh\b/i.test(value) &&
    /\bSafari\b/i.test(value) &&
    !/\b(Chrome|Chromium|Edg|OPR|Firefox|CriOS|FxiOS)\b/i.test(value)
  );
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
            : faList;
  return (
    <span className="nav-icon-frame">
      <FontAwesomeIcon className="nav-icon" icon={icon} aria-hidden="true" />
    </span>
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
    streamSource?.source === "local"
      ? copy.common.direct
      : streamSource?.source === "youtarr"
        ? copy.common.youtarr
        : copy.common.checkingLocal;
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
          className={`local-badge ${
            streamSource?.source === "local"
              ? "local-badge-direct"
              : streamSource?.source === "youtarr"
                ? "local-badge-youtarr"
                : "local-badge-checking"
          }`}
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
  onRemoveFromList,
  onPrepareCompatible,
  copy,
}: {
  video: FeedVideo;
  index: number;
  progress?: number;
  streamSource?: StreamSourceInfo | null;
  downloadJob?: DownloadJob;
  onOpen: (video: FeedVideo) => void;
  onChannel?: (channelId: string) => void;
  onDelete: (video: FeedVideo) => void;
  onRemoveFromList?: (video: FeedVideo) => void;
  onPrepareCompatible?: (video: FeedVideo) => void;
  copy: AppCopy;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const channel = {
    id: video.channelId,
    name: video.channelName,
    avatar: video.channelAvatar,
  };
  return (
    <article className="video-card">
      <button
        className="thumbnail-button"
        onClick={() => onOpen(video)}
        aria-label={video.title}
      >
        <Thumbnail
          video={video}
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
          onClick={() => onChannel?.(video.channelId)}
          disabled={!onChannel}
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
            className="more-button"
            aria-label={copy.menu.more}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <FontAwesomeIcon icon={faEllipsisVertical} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="video-menu">
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
                  {onPrepareCompatible && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onPrepareCompatible(video);
                      }}
                    >
                      {copy.menu.prepareCompatible}
                    </button>
                  )}
                  <button
                    className="danger-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete(video);
                    }}
                  >
                    {copy.common.deleteDownload}
                  </button>
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
  const [playbackQuality, setPlaybackQuality] = useState<PlayerQuality>(() => {
    if (typeof window === "undefined") return "auto";
    const storedQuality = window.localStorage.getItem(qualityStorageKey);
    return isPlayerQuality(storedQuality) ? storedQuality : "auto";
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
  const [selectedVideo, setSelectedVideo] = useState<FeedVideo | null>(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode>("full");
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerStreamMode, setPlayerStreamMode] = useState<PlayerStreamMode>("direct");
  const [transcodeState, setTranscodeState] = useState<
    "idle" | "checking" | "starting" | "running" | "ready" | "error"
  >("idle");
  const [transcodeError, setTranscodeError] = useState("");
  const [transcodeStartTime, setTranscodeStartTime] = useState(0);
  const [downloadJobs, setDownloadJobs] = useState<Record<string, DownloadJob>>({});
  const [deleteState, setDeleteState] = useState<"idle" | "deleting" | "error">(
    "idle"
  );
  const [deleteError, setDeleteError] = useState("");
  const [activity, setActivity] = useState<DownloadActivity | null>(null);
  const [watchProgress, setWatchProgress] = useState<WatchProgressMap>({});
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
  const [standaloneMode, setStandaloneMode] = useState(false);
  const [streamSource, setStreamSource] = useState<StreamSourceInfo | null>(null);
  const [streamSources, setStreamSources] = useState<Record<string, StreamSourceInfo>>({});
  const progressSaveRef = useRef<Record<string, number>>({});
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const intendedPlaybackRef = useRef(false);
  const pauseIntentTimerRef = useRef<number | null>(null);
  const pendingQualityResumeRef = useRef<{
    videoId: string;
    currentTime: number;
    wasPlaying: boolean;
  } | null>(null);
  const activeCompatibleRef = useRef<{
    videoId: string;
    outputMode: "file" | "hls";
  } | null>(null);
  const mode: AppMode = feed?.mode || "demo";
  const copy = translations[language];
  const shouldUseInlineWatchPage = useCallback(() => true, []);

  useEffect(() => {
    window.localStorage.setItem(languageStorageKey, language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(qualityStorageKey, playbackQuality);
  }, [playbackQuality]);

  const loadFeed = useCallback(async (quiet = false, refresh = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [feedResponse, statusResponse] = await Promise.all([
        fetch(`/api/feed${refresh ? "?refresh=1" : ""}`, { cache: "no-store" }),
        fetch("/api/status", { cache: "no-store" }),
      ]);
      const feedData = (await feedResponse.json()) as FeedResponse & {
        error?: string;
      };
      const statusData = (await statusResponse.json()) as FeedStatus;
      if (!feedResponse.ok) throw new Error(feedData.error || copy.errors.loadFeed);
      setFeed(feedData);
      setStatus(statusData);
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
        const data = (await response.json()) as { progress?: WatchProgressMap };
        if (!stopped) setWatchProgress(data.progress || {});
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
      if (status.plexConfigured) {
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
    // Local loaders are intentionally local to this component; view changes drive refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (
      playerMode === "full" &&
      selectedVideo?.downloaded &&
      mode === "live" &&
      playerRef.current &&
      !shouldUseInlineWatchPage()
    ) {
      updateMediaSession(selectedVideo);
      void requestNativeFullscreen(playerRef.current);
    }
  }, [mode, playerMode, selectedVideo, shouldUseInlineWatchPage]);

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
    if (!player || !selectedVideo?.downloaded || mode !== "live") {
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
    activeCompatibleRef.current =
      selectedVideo && playerStreamMode === "compatible"
        ? {
            videoId: selectedVideo.id,
            outputMode: streamSource?.transcode?.outputMode || "file",
          }
        : null;
  }, [playerStreamMode, selectedVideo, streamSource?.transcode?.outputMode]);

  useEffect(() => {
    function cleanupActiveCompatibleStream() {
      const activeCompatible = activeCompatibleRef.current;
      if (activeCompatible?.outputMode === "hls") {
        void stopCompatibleStream(activeCompatible.videoId, true);
      }
    }

    window.addEventListener("pagehide", cleanupActiveCompatibleStream);
    return () => {
      cleanupActiveCompatibleStream();
      window.removeEventListener("pagehide", cleanupActiveCompatibleStream);
    };
  }, []);

  useEffect(() => {
    intendedPlaybackRef.current = false;
    if (pauseIntentTimerRef.current) {
      window.clearTimeout(pauseIntentTimerRef.current);
      pauseIntentTimerRef.current = null;
    }
  }, [selectedVideo?.id]);

  useEffect(() => {
    if (playerStreamMode === "direct" || !playerRef.current) return;
    const player = playerRef.current;
    player.load();
    if (intendedPlaybackRef.current) {
      void player.play().catch(() => {
        setPlayerPlaying(false);
      });
    }
  }, [playerStreamMode]);

  useEffect(() => {
    let stopped = false;
    const resetTimer = window.setTimeout(() => {
      if (!stopped) setStreamSource(null);
    }, 0);

    async function loadStreamSource() {
      if (!selectedVideo?.downloaded || mode !== "live") return;
      try {
        const response = await fetch(
          `/api/stream/${encodeURIComponent(selectedVideo.id)}/source?detail=1&${qualityQuery()}`,
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
  }, [mode, playbackQuality, selectedVideo?.downloaded, selectedVideo?.id]);

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
    const progressVideos = [...(feed?.videos || []), ...singleVideos];
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
  }, [feed?.videos, query, singleVideos, watchProgress]);

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

  useEffect(() => {
    if (mode !== "live") return;
    const source =
      view === "continue"
        ? continueVideos
        : view === "local"
          ? filteredLocalVideos
          : view === "singles"
            ? filteredSingleVideos
            : visibleVideos;
    const candidates = source
      .filter((video) => video.downloaded && !streamSources[video.id])
      .slice(0, 80);
    if (candidates.length === 0) return;

    let stopped = false;
    async function loadCardSources() {
      const entries = await Promise.all(
        candidates.map(async (video) => {
          try {
            const response = await fetch(
              `/api/stream/${encodeURIComponent(video.id)}/source?${qualityQuery()}`,
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
    filteredLocalVideos,
    filteredSingleVideos,
    mode,
    playbackQuality,
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
    if (mode === "live") {
      void prepareCompatibleDownload(updated.id);
    }
  }

  function isApplePlaybackClient() {
    if (typeof navigator === "undefined") return false;
    return isApplePlaybackUserAgent(navigator.userAgent);
  }

  function qualityQuery() {
    return `quality=${encodeURIComponent(playbackQuality)}`;
  }

  function wait(milliseconds: number) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function pollTranscode(videoId: string) {
    for (let attempt = 0; attempt < 2400; attempt += 1) {
      const response = await fetch(`/api/transcode/${encodeURIComponent(videoId)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as TranscodeResponse;
      setStreamSources((current) => ({
        ...current,
        [videoId]: {
          ...(current[videoId] || {
            source: "local" as const,
            youtarrConfigured: true,
          }),
          transcode: data,
        },
      }));
      if (selectedVideo?.id === videoId) {
        setStreamSource((current) =>
          current ? { ...current, transcode: data } : current
        );
      }
      if (data.ready && (data.mediaUrl || data.playlistUrl)) {
        setTranscodeStartTime(data.startTime || 0);
        setTranscodeState("ready");
        return data;
      }
      if (data.error && !data.running) {
        throw new Error(data.error);
      }
      await wait(data.playbackMode === "vod" ? 1500 : 700);
    }
    throw new Error(copy.player.transcodeTimeout);
  }

  function stopCompatibleStream(videoId: string, keepalive = false) {
    return fetch(`/api/transcode/${encodeURIComponent(videoId)}`, {
      method: "DELETE",
      keepalive,
    }).catch(() => undefined);
  }

  async function prepareCompatibleDownload(videoId: string) {
    try {
      const response = await fetch(`/api/transcode/${encodeURIComponent(videoId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: 0 }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as TranscodeResponse;
      setStreamSources((current) => ({
        ...current,
        [videoId]: {
          ...(current[videoId] || {
            source: "local" as const,
            youtarrConfigured: true,
          }),
          transcode: data,
        },
      }));
    } catch {
      // Background compatible-file preparation should never block downloads.
    }
  }

  async function startCompatibleStream(video: FeedVideo) {
    const player = playerRef.current;
    const savedProgress = watchProgress[video.id]?.currentTime || 0;
    const playerTime =
      player && Number.isFinite(player.currentTime) ? player.currentTime : 0;
    const currentTime = playerStreamMode === "compatible"
      ? transcodeStartTime + playerTime
      : playerTime > 1
        ? playerTime
        : savedProgress;
    setTranscodeError("");
    setTranscodeState("starting");
    setTranscodeStartTime(0);
    setPlayerStreamMode("compatible");
    try {
      const response = await fetch(`/api/transcode/${encodeURIComponent(video.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: currentTime }),
      });
      const data = (await response.json()) as TranscodeResponse;
      if (!response.ok && data?.error) throw new Error(data.error);
      setTranscodeStartTime(data.startTime || 0);
      if (data.ready && (data.mediaUrl || data.playlistUrl)) {
        setTranscodeState("ready");
        return;
      }
      setTranscodeState("running");
      await pollTranscode(video.id);
    } catch (transcodeFailure) {
      setTranscodeState("error");
      setTranscodeError(
        transcodeFailure instanceof Error
          ? transcodeFailure.message
          : copy.player.transcodeFailed
      );
      setPlayerStreamMode("youtarr");
    }
  }

  async function chooseInitialStream(video: FeedVideo) {
    setPlayerStreamMode("direct");
    setTranscodeState("idle");
    setTranscodeStartTime(0);
    setTranscodeError("");

    if (!isApplePlaybackClient()) return;
    try {
      setTranscodeState("checking");
      const response = await fetch(`/api/transcode/${encodeURIComponent(video.id)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setTranscodeState("idle");
        return;
      }
      const data = (await response.json()) as TranscodeResponse;
      setStreamSource((current) =>
        current ? { ...current, transcode: data } : current
      );
      if (data.ready && (data.mediaUrl || data.playlistUrl) && data.appleDecision?.suggested) {
        setPlayerStreamMode("compatible");
        setTranscodeStartTime(data.startTime || 0);
        setTranscodeState("ready");
        return;
      }
      setPlayerStreamMode("direct");
      setTranscodeState("idle");
    } catch {
      setPlayerStreamMode("direct");
      setTranscodeState("idle");
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
            `/api/stream/${encodeURIComponent(video.id)}/source?${qualityQuery()}`,
            { cache: "no-store" }
          );
          if (response.ok) {
            const source = (await response.json()) as StreamSourceInfo;
            setStreamSources((current) => ({ ...current, [video.id]: source }));
            if (source.source === "local") {
              const downloadedVideo = { ...video, downloaded: true };
              markVideoDownloaded(downloadedVideo);
              const appleClient = isApplePlaybackClient();
              setPlayerStreamMode("direct");
              setTranscodeState(appleClient ? "checking" : "idle");
              setTranscodeStartTime(0);
              setTranscodeError("");
              setSelectedVideo(downloadedVideo);
              setPlayerMode("full");
              setPlayerPlaying(false);
              setDeleteState("idle");
              setDeleteError("");
              void chooseInitialStream(downloadedVideo);
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
    const appleClient = isApplePlaybackClient();
    setPlayerStreamMode("direct");
    setTranscodeState(appleClient ? "checking" : "idle");
    setTranscodeStartTime(0);
    setTranscodeError("");
    setSelectedVideo(video);
    setPlayerMode("full");
    setPlayerPlaying(false);
    setDeleteState("idle");
    setDeleteError("");
    void chooseInitialStream(video);
  }

  function closePlayer() {
    if (selectedVideo?.downloaded && mode === "live" && playerMode === "full") {
      setPlayerMode("mini");
      return;
    }
    if (
      selectedVideo &&
      playerStreamMode === "compatible" &&
      streamSource?.transcode?.outputMode === "hls"
    ) {
      void stopCompatibleStream(selectedVideo.id);
    }
    playerRef.current?.pause();
    intendedPlaybackRef.current = false;
    setPlayerStreamMode("direct");
    setTranscodeState("idle");
    setTranscodeStartTime(0);
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

  async function startDownload(video: FeedVideo) {
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
    if (playerStreamMode === "compatible") return knownVideoDuration(video);
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
    const streamOffset = playerStreamMode === "compatible" ? transcodeStartTime : 0;
    const currentTime = Math.max(
      0,
      Math.min(streamOffset + player.currentTime, duration || streamOffset + player.currentTime)
    );
    storeWatchProgress(video.id, currentTime, duration, force);
  }

  function storeWatchProgress(
    videoId: string,
    currentTime: number,
    duration: number,
    force = false
  ) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    if (!force && now - (progressSaveRef.current[videoId] || 0) < 4000) return;
    progressSaveRef.current[videoId] = now;

    let nextEntry: WatchProgressEntry | null = null;
    setWatchProgress((current) => {
      const next = { ...current };
      if (currentTime < 5 || currentTime > duration - 8) {
        delete next[videoId];
      } else {
        nextEntry = { videoId, currentTime, duration, updatedAt: now };
        next[videoId] = nextEntry;
      }
      return next;
    });

    void fetch("/api/watch-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId,
        currentTime,
        duration,
      }),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { progress?: WatchProgressMap };
        if (data.progress) setWatchProgress(data.progress);
      })
      .catch(() => {
        if (nextEntry) {
          setWatchProgress((current) => ({ ...current, [videoId]: nextEntry }));
        }
      });
  }

  function resumePlayback(video: FeedVideo, player: HTMLVideoElement) {
    const videoId = video.id;
    const pendingResume = pendingQualityResumeRef.current;
    if (pendingResume?.videoId === videoId) {
      pendingQualityResumeRef.current = null;
      try {
        player.currentTime = Math.max(0, pendingResume.currentTime);
      } catch {
        // Some mobile players reject seeking until enough metadata is available.
      }
      if (pendingResume.wasPlaying) {
        void player.play().catch(() => setPlayerPlaying(false));
      }
      return;
    }

    const progress = watchProgress[videoId];
    if (!progress || progress.currentTime < 5) return;
    const duration = playerProgressDuration(video, player) || progress.duration;
    if (progress.currentTime < duration - 8) {
      try {
        player.currentTime = Math.max(
          0,
          progress.currentTime -
            (playerStreamMode === "compatible" ? transcodeStartTime : 0)
        );
      } catch {
        // In-progress HLS playlists may reject seeking until later segments exist.
      }
    }
  }

  function progressPercent(videoId: string) {
    const progress = watchProgress[videoId];
    if (!progress?.duration) return undefined;
    return Math.max(2, Math.min(98, (progress.currentTime / progress.duration) * 100));
  }

  function switchPlaybackQuality(video: FeedVideo, quality: PlayerQuality) {
    if (quality === playbackQuality) return;

    const player = playerRef.current;
    if (player) {
      const duration = playerProgressDuration(video, player);
      const streamOffset = playerStreamMode === "compatible" ? transcodeStartTime : 0;
      const currentTime = Math.max(0, streamOffset + (player.currentTime || 0));
      pendingQualityResumeRef.current = {
        videoId: video.id,
        currentTime,
        wasPlaying: !player.paused && !player.ended,
      };
      if (duration > 0) {
        storeWatchProgress(video.id, currentTime, duration, true);
      }
    }

    setPlaybackQuality(quality);
    setPlayerStreamMode("direct");
    setTranscodeState("idle");
    setTranscodeStartTime(0);
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
      if (selectedVideo?.id === video.id) {
        setSelectedVideo(null);
      }
      setWatchProgress((current) => {
        const next = { ...current };
        delete next[video.id];
        return next;
      });
      setLocalVideos((current) => current.filter((item) => item.id !== video.id));
      setSingleVideos((current) =>
        current.map((item) =>
          item.id === video.id ? { ...item, downloaded: false } : item
        )
      );
      setDeleteState("idle");
      void loadFeed(true, true);
      if (view === "local") {
        void loadLocalVideos(true, true);
      }
      if (view === "singles") {
        void loadSingleVideos(true);
      }
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

  function switchView(next: View) {
    setView(next);
    setSelectedChannel(null);
    setChannelVideos([]);
    setFilter("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeActivity =
    status?.mode === "live" && activity && activity.state !== "idle"
      ? activity
      : null;
  const selectedVideoId = selectedVideo
    ? encodeURIComponent(selectedVideo.id)
    : "";
  const compatiblePlayerSource =
    streamSource?.transcode?.mediaUrl ||
    streamSource?.transcode?.playlistUrl ||
    `/api/transcode/${selectedVideoId}/hls/index.m3u8`;
  const directPlayerSource = `/api/stream/${selectedVideoId}?${qualityQuery()}${
    playerStreamMode === "youtarr" ? "&direct=0" : ""
  }`;
  const localVariants = streamSource?.local?.variants || [];
  const hasQualityVariants =
    localVariants.some((variant) => variant.quality === "original") &&
    localVariants.some((variant) => variant.quality === "1080");
  const playerSource = selectedVideo
    ? playerStreamMode === "compatible" && transcodeState === "ready"
      ? compatiblePlayerSource
      : directPlayerSource
    : "";
  const transcodePreparing =
    selectedVideo?.downloaded &&
    playerStreamMode === "compatible" &&
    transcodeState !== "ready";
  const inlineWatchPage = selectedVideo ? shouldUseInlineWatchPage() : false;

  return (
    <div className="app-shell">
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
            onClick={() => void loadFeed(true, true)}
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
                    onPrepareCompatible={(item) => void prepareCompatibleDownload(item.id)}
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
                    onPrepareCompatible={(item) => void prepareCompatibleDownload(item.id)}
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
                    onPrepareCompatible={(item) => void prepareCompatibleDownload(item.id)}
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
                    onPrepareCompatible={(item) => void prepareCompatibleDownload(item.id)}
                    onRemoveFromList={(item) => void removeSingleVideo(item)}
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

        {view === "channels" && !selectedChannel && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">{copy.channels.eyebrow}</span>
                <h1>{copy.channels.title}</h1>
                <p>{copy.channels.subscriptions(feed?.channels.length || 0)}</p>
              </div>
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
                    onPrepareCompatible={(item) => void prepareCompatibleDownload(item.id)}
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
            <button
              className={`modal-close ${
                playerMode === "mini" ? "modal-close-x" : "modal-close-minimize"
              }`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={closePlayer}
              aria-label={playerMode === "mini" ? copy.common.close : copy.common.minimize}
            >
              <FontAwesomeIcon
                icon={playerMode === "mini" ? faXmark : faMinus}
                aria-hidden="true"
              />
            </button>
            {playerMode === "full" &&
              standaloneMode &&
              selectedVideo.downloaded &&
              mode === "live" && (
                <button
                  className="modal-pip"
                  onMouseDown={(event) => event.stopPropagation()}
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
            {selectedVideo.downloaded && mode === "live" ? (
              <>
                <div className="player-frame">
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
                        true
                      );
                    }}
                    onError={(event) => {
                      intendedPlaybackRef.current =
                        intendedPlaybackRef.current || !event.currentTarget.paused;
                      if (playerStreamMode === "direct" && isApplePlaybackClient()) {
                        void startCompatibleStream(selectedVideo);
                        return;
                      }
                      if (playerStreamMode === "direct") {
                        const fallbackSource: StreamSourceInfo = {
                          source: "youtarr",
                          local: streamSource?.local,
                          transcode: streamSource?.transcode,
                          youtarrConfigured: streamSource?.youtarrConfigured ?? true,
                        };
                        setStreamSource(fallbackSource);
                        setStreamSources((current) => ({
                          ...current,
                          [selectedVideo.id]: fallbackSource,
                        }));
                        setPlayerStreamMode("youtarr");
                      }
                    }}
                  />
                  {transcodePreparing && (
                    <div className="player-busy-overlay" aria-live="polite">
                      <span>
                        <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
                      </span>
                    </div>
                  )}
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
                onClick={() => {
                  const id = selectedVideo.channelId;
                  setSelectedVideo(null);
                  void openChannel(id);
                }}
              >
                {selectedVideo.channelName}
              </button>
              <span>{relativeDate(selectedVideo.publishedAt, copy)}</span>
              {selectedVideo.downloaded && (
                <p
                  className={`stream-source stream-source-${
                    playerStreamMode === "compatible"
                      ? "compatible"
                      : streamSource?.source || "unknown"
                  }`}
                >
                  <strong>
                    {playerStreamMode === "compatible"
                      ? copy.player.sourceCompatible
                      : streamSource?.source === "local"
                      ? copy.player.sourceDirect
                      : streamSource?.source === "youtarr"
                        ? copy.player.sourceYoutarr
                        : copy.player.sourceChecking}
                  </strong>
                  {playerStreamMode === "compatible"
                    ? copy.player.sourceCompatibleBody
                    : streamSource?.source === "local" && streamSource.local?.fileName
                    ? copy.player.sourceDirectBody(streamSource.local.fileName)
                    : streamSource?.local?.configured === false
                      ? copy.player.sourceNoMount
                      : streamSource?.source === "youtarr"
                        ? copy.player.sourceFallback
                        : copy.player.sourceCheckingBody}
                </p>
              )}
              {selectedVideo.downloaded &&
                mode === "live" &&
                hasQualityVariants && (
                  <div className="stream-switch" aria-label={copy.player.qualityMode}>
                    {[
                      ["auto", copy.player.useAutoQuality],
                      ["original", copy.player.useOriginalQuality],
                      ["1080", copy.player.use1080Quality],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={playbackQuality === value ? "active" : ""}
                        onClick={() =>
                          switchPlaybackQuality(selectedVideo, value as PlayerQuality)
                        }
                      >
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              {selectedVideo.downloaded &&
                mode === "live" &&
                streamSource?.transcode?.enabled &&
                isApplePlaybackClient() && (
                  <div className="stream-switch" aria-label={copy.player.streamMode}>
                    <button
                      className={playerStreamMode !== "compatible" ? "active" : ""}
                      onClick={() => {
                        setTranscodeError("");
                        if (
                          selectedVideo &&
                          playerStreamMode === "compatible" &&
                          streamSource?.transcode?.outputMode === "hls"
                        ) {
                          void stopCompatibleStream(selectedVideo.id);
                        }
                        setPlayerStreamMode("direct");
                        setTranscodeState("idle");
                        setTranscodeStartTime(0);
                      }}
                    >
                      <FontAwesomeIcon icon={faFilm} aria-hidden="true" />
                      <span>{copy.player.useDefault}</span>
                    </button>
                    <button
                      className={playerStreamMode === "compatible" ? "active" : ""}
                      onClick={() => void startCompatibleStream(selectedVideo)}
                      disabled={
                        transcodeState === "checking" ||
                        transcodeState === "starting" ||
                        transcodeState === "running"
                      }
                    >
                      <FontAwesomeIcon
                        icon={
                          transcodeState === "checking" ||
                          transcodeState === "starting" ||
                          transcodeState === "running"
                            ? faRotateRight
                            : faBolt
                        }
                        aria-hidden="true"
                      />
                      <span>
                        {transcodeState === "checking" ||
                        transcodeState === "starting" ||
                        transcodeState === "running"
                          ? copy.player.transcoding
                          : copy.player.useCompatible}
                      </span>
                    </button>
                  </div>
                )}
              {transcodeError && <small className="transcode-error">{transcodeError}</small>}
              {selectedVideo.downloaded && (
                <div className="modal-actions">
                  <button
                    className="danger-button"
                    onClick={() => void removeDownload(selectedVideo)}
                    disabled={deleteState === "deleting"}
                  >
                    {deleteState === "deleting" ? copy.player.deleting : copy.common.deleteDownload}
                  </button>
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
              <div>
                <span>{copy.settings.qualityLabel}</span>
                <strong className="language-switcher">
                  {[
                    ["auto", copy.settings.qualityAuto],
                    ["original", copy.settings.qualityOriginal],
                    ["1080", copy.settings.quality1080],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={playbackQuality === value ? "active" : ""}
                      onClick={() => setPlaybackQuality(value as PlayerQuality)}
                    >
                      {label}
                    </button>
                  ))}
                </strong>
              </div>
            </div>
            <button className="primary-button" onClick={() => setSettingsOpen(false)}>
              {copy.common.done}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
