"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
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

type View = "feed" | "continue" | "channels";
type Filter = "all" | "new" | "downloaded";
type PlayerMode = "full" | "mini";
type WebKitVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: "fullscreen" | "inline" | "picture-in-picture") => void;
  webkitSupportsPresentationMode?: (mode: "picture-in-picture") => boolean;
};

const palette = ["coral", "blue", "lime", "violet", "gold"];

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

function relativeDate(value: string | null) {
  if (!value) return "Onbekende datum";
  const difference = Date.now() - new Date(value).getTime();
  const hours = Math.max(1, Math.floor(difference / 3_600_000));
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "dag" : "dagen"} geleden`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? "week" : "weken"} geleden`;
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatEta(seconds?: number) {
  if (!seconds) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min resterend`;
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
}: {
  video: FeedVideo;
  index: number;
  progress?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`thumbnail thumbnail-${palette[index % palette.length]}`}>
      {video.thumbnail && !failed ? (
        // De bron wisselt per video; optimalisatie gebeurt al bij YouTube/Youtarr.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={video.thumbnail}
          alt=""
          onError={() => setFailed(true)}
          loading="lazy"
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
        <span className="local-badge">Lokaal</span>
      ) : (
        <span className="cloud-badge">Nog ophalen</span>
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
  onOpen,
  onChannel,
  onDelete,
}: {
  video: FeedVideo;
  index: number;
  progress?: number;
  onOpen: (video: FeedVideo) => void;
  onChannel: (channelId: string) => void;
  onDelete: (video: FeedVideo) => void;
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
        aria-label={`${video.title} openen`}
      >
        <Thumbnail video={video} index={index} progress={progress} />
      </button>
      <div className="video-details">
        <button
          className="avatar-button"
          onClick={() => onChannel(video.channelId)}
          aria-label={`${video.channelName} openen`}
        >
          <ChannelAvatar channel={channel} size="small" />
        </button>
        <button className="video-copy" onClick={() => onOpen(video)}>
          <strong>{video.title}</strong>
          <span>
            {video.channelName} · {relativeDate(video.publishedAt)}
          </span>
        </button>
        <div className="video-menu-wrap">
          <button
            className="more-button"
            aria-label="Meer opties"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          {menuOpen && (
            <div className="video-menu">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpen(video);
                }}
              >
                {video.downloaded ? "Afspelen" : "Ophalen"}
              </button>
              {video.downloaded && (
                <button
                  className="danger-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(video);
                  }}
                >
                  Download verwijderen
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function LoadingGrid() {
  return (
    <div className="video-grid" aria-label="Feed laden">
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
  const [selectedVideo, setSelectedVideo] = useState<FeedVideo | null>(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode>("full");
  const [downloadState, setDownloadState] = useState<
    "idle" | "queueing" | "queued" | "error"
  >("idle");
  const [downloadError, setDownloadError] = useState("");
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [standaloneMode, setStandaloneMode] = useState(false);
  const progressSaveRef = useRef<Record<string, number>>({});
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const intendedPlaybackRef = useRef(false);
  const pauseIntentTimerRef = useRef<number | null>(null);
  const mode: AppMode = feed?.mode || "demo";

  const loadFeed = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [feedResponse, statusResponse] = await Promise.all([
        fetch("/api/feed", { cache: "no-store" }),
        fetch("/api/status", { cache: "no-store" }),
      ]);
      const feedData = (await feedResponse.json()) as FeedResponse & {
        error?: string;
      };
      const statusData = (await statusResponse.json()) as FeedStatus;
      if (!feedResponse.ok) throw new Error(feedData.error || "Feed laden mislukte");
      setFeed(feedData);
      setStatus(statusData);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Feed laden mislukte"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFeed(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFeed]);

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
        // Kijkvoortgang mag de feed nooit blokkeren.
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
        // De volgende poll probeert het opnieuw.
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
    if (downloadState !== "queued" || !selectedVideo || status?.mode !== "live") {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/channels/${encodeURIComponent(selectedVideo.channelId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) return;
        const data = (await response.json()) as { videos: FeedVideo[] };
        const updated = data.videos.find((video) => video.id === selectedVideo.id);
        if (updated?.downloaded) {
          setSelectedVideo(updated);
          setDownloadState("idle");
          window.clearInterval(timer);
          if (status.plexConfigured) {
            void fetch("/api/plex/refresh", { method: "POST" });
          }
          void loadFeed(true);
        }
      } catch {
        // De volgende poll probeert het opnieuw.
      }
    }, 7000);
    return () => window.clearInterval(timer);
  }, [
    downloadState,
    loadFeed,
    selectedVideo,
    status?.mode,
    status?.plexConfigured,
  ]);

  useEffect(() => {
    if (
      playerMode === "full" &&
      selectedVideo?.downloaded &&
      mode === "live" &&
      playerRef.current
    ) {
      updateMediaSession(selectedVideo);
      void requestNativeFullscreen(playerRef.current);
    }
  }, [mode, playerMode, selectedVideo]);

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
              // iOS kan hervatten weigeren; dan blijft de mini-speler netjes gepauzeerd.
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
    return (feed?.videos || [])
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
  }, [feed?.videos, query, watchProgress]);

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
      if (!response.ok) throw new Error(data.error || "Kanaal laden mislukte");
      setChannelVideos(data.videos || []);
    } catch (channelError) {
      setError(
        channelError instanceof Error
          ? channelError.message
          : "Kanaal laden mislukte"
      );
    } finally {
      setChannelLoading(false);
    }
  }

  function openVideo(video: FeedVideo) {
    setSelectedVideo(video);
    setPlayerMode("full");
    setDownloadState("idle");
    setDownloadError("");
    setDeleteState("idle");
    setDeleteError("");
    if (!video.downloaded) {
      void startDownload(video);
    }
  }

  function closePlayer() {
    if (selectedVideo?.downloaded && mode === "live" && playerMode === "full") {
      setPlayerMode("mini");
      return;
    }
    setSelectedVideo(null);
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
      // iOS accepteert fullscreen alleen wanneer Safari de gesture toestaat.
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
      // iOS/Safari bepaalt zelf of PiP in standalone PWA's beschikbaar is.
    }
  }

  async function startDownload(video: FeedVideo) {
    setDownloadState("queueing");
    setDownloadError("");
    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.id }),
      });
      const data = (await response.json()) as {
        error?: string;
        demo?: boolean;
      };
      if (!response.ok) throw new Error(data.error || "Download starten mislukte");
      setDownloadState("queued");
      if (data.demo) {
        window.setTimeout(() => {
          setSelectedVideo((current) =>
            current ? { ...current, downloaded: true } : current
          );
          setDownloadState("idle");
        }, 3200);
      }
    } catch (downloadFailure) {
      setDownloadState("error");
      setDownloadError(
        downloadFailure instanceof Error
          ? downloadFailure.message
          : "Download starten mislukte"
      );
    }
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

  function resumePlayback(videoId: string, player: HTMLVideoElement) {
    const progress = watchProgress[videoId];
    if (!progress || progress.currentTime < 5) return;
    const duration = Number.isFinite(player.duration)
      ? player.duration
      : progress.duration;
    if (progress.currentTime < duration - 8) {
      player.currentTime = progress.currentTime;
    }
  }

  function progressPercent(videoId: string) {
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
      if (!response.ok) throw new Error(data.error || "Verwijderen mislukte");
      if (selectedVideo?.id === video.id) {
        setSelectedVideo(null);
      }
      setWatchProgress((current) => {
        const next = { ...current };
        delete next[video.id];
        return next;
      });
      setDeleteState("idle");
      void loadFeed(true);
    } catch (deleteFailure) {
      setDeleteState("error");
      setDeleteError(
        deleteFailure instanceof Error
          ? deleteFailure.message
          : "Verwijderen mislukte"
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
      if (!response.ok) throw new Error(data.error || "Kanaal toevoegen mislukte");
      setChannelUrl("");
      setAddChannelState("added");
      setAddChannelMessage(
        data.channel?.restored
          ? `${data.channel.name || "Kanaal"} is hersteld`
          : `${data.channel?.name || "Kanaal"} is toegevoegd`
      );
      void loadFeed(true);
    } catch (addFailure) {
      setAddChannelState("error");
      setAddChannelMessage(
        addFailure instanceof Error
          ? addFailure.message
          : "Kanaal toevoegen mislukte"
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => switchView("feed")}>
          <span className="brand-mark">
            <i />
          </span>
          <span>Youtarr</span>
        </button>
        <div className={`search-wrap ${searchOpen ? "search-open" : ""}`}>
          <span className="search-icon" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Zoeken in je feed"
            aria-label="Zoeken in je feed"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Zoekopdracht wissen">
              ×
            </button>
          )}
        </div>
        <div className="top-actions">
          <button
            className="round-button mobile-search"
            onClick={() => setSearchOpen((open) => !open)}
            aria-label="Zoeken"
          >
            <span className="search-icon" />
          </button>
          <button
            className={`round-button refresh-button ${refreshing ? "spinning" : ""}`}
            onClick={() => void loadFeed(true)}
            aria-label="Feed verversen"
          >
            ↻
          </button>
          <button
            className="profile-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Koppeling en instellingen"
          >
            NF
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <nav aria-label="Hoofdnavigatie">
          <button
            className={view === "feed" ? "active" : ""}
            onClick={() => switchView("feed")}
          >
            <span className="nav-home" />
            <span>Feed</span>
          </button>
          <button
            className={view === "continue" ? "active" : ""}
            onClick={() => switchView("continue")}
          >
            <span className="nav-continue" />
            <span>Verder kijken</span>
          </button>
          <button
            className={view === "channels" ? "active" : ""}
            onClick={() => switchView("channels")}
          >
            <span className="nav-channels">
              <i />
              <i />
              <i />
            </span>
            <span>Kanalen</span>
          </button>
        </nav>
        <div className="sidebar-status">
          <span className={`status-dot status-${mode}`} />
          <div>
            <strong>{status?.connected ? "Verbonden" : "Voorbeeld"}</strong>
            <small>{status?.server || "Nog niet gekoppeld"}</small>
          </div>
        </div>
      </aside>

      <main>
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => void loadFeed()}>Opnieuw proberen</button>
          </div>
        )}

        {activeActivity && (
          <section className={`activity-strip activity-${activeActivity.state}`}>
            <div>
              <strong>{activeActivity.label}</strong>
              <span>{formatEta(activeActivity.etaSeconds) || "Youtarr werkt op de achtergrond"}</span>
            </div>
            <div className="activity-meter" aria-label="Downloadvoortgang">
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
                  {mode === "live" ? "Bijgewerkt vanuit Youtarr" : "Voorbeeldmodus"}
                </span>
                <h1>Je abonnementen</h1>
                <p>Alles van je kanalen, nieuwste video eerst.</p>
              </div>
              <button className="settings-link" onClick={() => setSettingsOpen(true)}>
                Koppeling
              </button>
            </section>
            <div className="filter-row" role="group" aria-label="Video’s filteren">
              {[
                ["all", "Alles"],
                ["new", "Nog ophalen"],
                ["downloaded", "Gedownload"],
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
              <LoadingGrid />
            ) : visibleVideos.length ? (
              <div className="video-grid">
                {visibleVideos.map((video, index) => (
                  <VideoCard
                    key={`${video.channelId}-${video.id}`}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    onOpen={openVideo}
                    onChannel={(id) => void openChannel(id)}
                    onDelete={(item) => void removeDownload(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark">0</span>
                <h2>Geen video’s gevonden</h2>
                <p>Pas je filter of zoekopdracht aan.</p>
              </div>
            )}
          </>
        )}

        {view === "continue" && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">Gesynchroniseerd</span>
                <h1>Verder kijken</h1>
                <p>Video&apos;s waar je op deze server al aan begonnen bent.</p>
              </div>
            </section>
            {loading ? (
              <LoadingGrid />
            ) : continueVideos.length ? (
              <div className="video-grid">
                {continueVideos.map((video, index) => (
                  <VideoCard
                    key={`${video.channelId}-${video.id}`}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    onOpen={openVideo}
                    onChannel={(id) => void openChannel(id)}
                    onDelete={(item) => void removeDownload(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-mark">0</span>
                <h2>Niets om verder te kijken</h2>
                <p>Start een gedownloade video en je vindt hem hier terug.</p>
              </div>
            )}
          </>
        )}

        {view === "channels" && !selectedChannel && (
          <>
            <section className="page-heading">
              <div>
                <span className="eyebrow">Jouw bibliotheek</span>
                <h1>Kanalen</h1>
                <p>{feed?.channels.length || 0} actieve abonnementen</p>
              </div>
            </section>
            <form className="add-channel-form" onSubmit={submitChannel}>
              <input
                value={channelUrl}
                onChange={(event) => setChannelUrl(event.target.value)}
                placeholder="YouTube-kanaal URL of handle"
                aria-label="YouTube-kanaal URL of handle"
              />
              <button
                className="primary-button"
                disabled={addChannelState === "adding" || mode !== "live"}
              >
                {addChannelState === "adding" ? "Bezig" : "Toevoegen"}
              </button>
              {addChannelMessage && (
                <span className={`form-message form-${addChannelState}`}>
                  {addChannelMessage}
                </span>
              )}
            </form>
            {loading ? (
              <LoadingGrid />
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
                          ? "Automatisch downloaden"
                          : "Downloaden bij openen"}
                      </small>
                    </span>
                    <span className="chevron">›</span>
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
              <span>‹</span> Alle kanalen
            </button>
            <section className="channel-hero">
              <ChannelAvatar channel={selectedChannel} size="large" />
              <div>
                <span className="eyebrow">Kanaal</span>
                <h1>{selectedChannel.name}</h1>
                <p>
                  {selectedChannel.autoDownload
                    ? "Nieuwe video’s worden automatisch opgehaald"
                    : "Tik op een video om hem op te halen"}
                </p>
              </div>
            </section>
            <div className="filter-row" role="group" aria-label="Video’s filteren">
              {[
                ["all", "Alles"],
                ["new", "Nog ophalen"],
                ["downloaded", "Gedownload"],
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
              <LoadingGrid />
            ) : (
              <div className="video-grid">
                {visibleVideos.map((video, index) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    index={index}
                    progress={progressPercent(video.id)}
                    onOpen={openVideo}
                    onChannel={() => undefined}
                    onDelete={(item) => void removeDownload(item)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Hoofdnavigatie">
        <button
          className={view === "feed" ? "active" : ""}
          onClick={() => switchView("feed")}
        >
          <span className="nav-home" />
          <small>Feed</small>
        </button>
        <button
          className={view === "continue" ? "active" : ""}
          onClick={() => switchView("continue")}
        >
          <span className="nav-continue" />
          <small>Verder</small>
        </button>
        <button
          className={view === "channels" ? "active" : ""}
          onClick={() => switchView("channels")}
        >
          <span className="nav-channels">
            <i />
            <i />
            <i />
          </span>
          <small>Kanalen</small>
        </button>
      </nav>

      {selectedVideo && (
        <div
          className={
            playerMode === "mini"
              ? "mini-player-shell"
              : "modal-backdrop player-backdrop"
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
              playerMode === "mini" ? "video-modal video-modal-mini" : "video-modal"
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
              aria-label={playerMode === "mini" ? "Sluiten" : "Klein maken"}
            >
              {playerMode === "mini" ? "x" : "-"}
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
                  aria-label="Picture-in-picture"
                >
                  PiP
                </button>
              )}
            {selectedVideo.downloaded && mode === "live" ? (
              <video
                ref={playerRef}
                className="player"
                controls={playerMode === "full"}
                autoPlay
                playsInline
                disableRemotePlayback={false}
                preload="metadata"
                poster={selectedVideo.thumbnail || undefined}
                src={`/api/stream/${encodeURIComponent(selectedVideo.id)}`}
                onLoadedMetadata={(event) => {
                  event.currentTarget.setAttribute("x-webkit-airplay", "allow");
                  event.currentTarget.setAttribute("webkit-playsinline", "true");
                  updateMediaSession(selectedVideo);
                  updateMediaSessionControls(event.currentTarget);
                  resumePlayback(selectedVideo.id, event.currentTarget);
                  if (playerMode === "full") {
                    void requestNativeFullscreen(event.currentTarget);
                  }
                }}
                onPlay={(event) => {
                  if (pauseIntentTimerRef.current) {
                    window.clearTimeout(pauseIntentTimerRef.current);
                    pauseIntentTimerRef.current = null;
                  }
                  intendedPlaybackRef.current = true;
                  updateMediaSession(selectedVideo);
                  updateMediaSessionControls(event.currentTarget);
                  if ("mediaSession" in navigator) {
                    navigator.mediaSession.playbackState = "playing";
                  }
                  if (playerMode === "full") {
                    void requestNativeFullscreen(event.currentTarget);
                  }
                }}
                onTimeUpdate={(event) =>
                  storeWatchProgress(
                    selectedVideo.id,
                    event.currentTarget.currentTime,
                    event.currentTarget.duration
                  )
                }
                onPause={(event) => {
                  if (pauseIntentTimerRef.current) {
                    window.clearTimeout(pauseIntentTimerRef.current);
                  }
                  pauseIntentTimerRef.current = window.setTimeout(() => {
                    intendedPlaybackRef.current = false;
                    pauseIntentTimerRef.current = null;
                  }, 350);
                  if ("mediaSession" in navigator) {
                    navigator.mediaSession.playbackState = "paused";
                  }
                  storeWatchProgress(
                    selectedVideo.id,
                    event.currentTarget.currentTime,
                    event.currentTarget.duration,
                    true
                  );
                }}
                onEnded={(event) =>
                  storeWatchProgress(
                    selectedVideo.id,
                    event.currentTarget.duration,
                    event.currentTarget.duration,
                    true
                  )
                }
              />
            ) : selectedVideo.downloaded ? (
              <div className="demo-player">
                <span className="demo-play">▶</span>
                <p>In de gekoppelde versie speelt hier je lokale bestand.</p>
              </div>
            ) : (
              <div className="download-panel">
                <div
                  className={`download-orbit ${
                    downloadState === "queueing" || downloadState === "queued"
                      ? "active"
                      : ""
                  }`}
                >
                  <span>↓</span>
                </div>
                <span className="eyebrow">Nog niet lokaal</span>
                <h2>
                  {downloadState === "queueing" && "Download wordt aangevraagd"}
                  {downloadState === "queued" && "Youtarr is bezig"}
                  {downloadState === "error" && "Dat ging niet goed"}
                  {downloadState === "idle" && "Klaar om op te halen"}
                </h2>
                <p>
                  {downloadState === "queued"
                    ? "Je kunt dit scherm sluiten. De video verschijnt automatisch zodra hij klaar is."
                    : downloadState === "error"
                      ? downloadError
                      : "De video wordt via Youtarr aan je eigen bibliotheek toegevoegd."}
                </p>
                {downloadState === "error" && (
                  <button
                    className="primary-button"
                    onClick={() => void startDownload(selectedVideo)}
                  >
                    Opnieuw proberen
                  </button>
                )}
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
              <span>{relativeDate(selectedVideo.publishedAt)}</span>
              {selectedVideo.downloaded && (
                <div className="modal-actions">
                  <button
                    className="danger-button"
                    onClick={() => void removeDownload(selectedVideo)}
                    disabled={deleteState === "deleting"}
                  >
                    {deleteState === "deleting" ? "Verwijderen" : "Download verwijderen"}
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
            aria-label="Youtarr-koppeling"
          >
            <button
              className="modal-close"
              onClick={() => setSettingsOpen(false)}
              aria-label="Sluiten"
            >
              ×
            </button>
            <span className={`connection-icon connection-${mode}`}>
              <i />
            </span>
            <span className="eyebrow">Koppeling</span>
            <h2>
              {status?.connected
                ? "Youtarr is verbonden"
                : "De interface staat in voorbeeldmodus"}
            </h2>
            <p>
              {status?.connected
                ? `De feed gebruikt ${status.server || "je Youtarr-server"} en ververst automatisch je abonnementen.`
                : "Zodra de servergegevens zijn ingevuld, worden deze voorbeeldvideo’s vervangen door jouw eigen abonnementen."}
            </p>
            <div className="settings-facts">
              <div>
                <span>Feed</span>
                <strong>Youtarr-kanalen</strong>
              </div>
              <div>
                <span>Plex</span>
                <strong>
                  {status?.plexConfigured
                    ? "Scan na download"
                    : "Via Youtarr geregeld"}
                </strong>
              </div>
              <div>
                <span>Ontbrekende video</span>
                <strong>Direct downloaden</strong>
              </div>
            </div>
            <button className="primary-button" onClick={() => setSettingsOpen(false)}>
              Begrepen
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
