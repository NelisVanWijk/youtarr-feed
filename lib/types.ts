export type AppMode = "live" | "demo";

export interface FeedStatus {
  mode: AppMode;
  connected: boolean;
  message: string;
  server?: string;
  plexConfigured?: boolean;
  plexServer?: string;
  diagnostics?: AppDiagnostics;
}

export interface SettingValue {
  key: string;
  label: string;
  value: string;
  secret?: boolean;
}

export interface ConnectionStatus {
  ok: boolean;
  status?: number;
  message: string;
}

export interface ServiceDiagnostic {
  key: string;
  label: string;
  configured: boolean;
  connection: ConnectionStatus;
  settings: SettingValue[];
}

export interface YoutarrDiagnostics {
  playbackProfile: string;
  effectiveProfiles: {
    ipadMacSafari: string;
    iphone: string;
    fallback: string;
  };
  instances: ServiceDiagnostic[];
}

export interface AppDiagnostics {
  youtarr: YoutarrDiagnostics;
  plex: ServiceDiagnostic;
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  avatar: string;
  autoDownload: boolean;
  videoQuality?: string | null;
}

export interface FeedVideo {
  id: string;
  channelId: string;
  channelName: string;
  channelAvatar: string;
  title: string;
  thumbnail: string;
  publishedAt: string | null;
  duration: number;
  downloaded: boolean;
  missing: boolean;
  watched: boolean;
  removedFromYouTube?: boolean;
  filePath?: string | null;
}

export interface FeedResponse {
  mode: AppMode;
  videos: FeedVideo[];
  channels: Channel[];
  warnings?: string[];
}

export interface DownloadProgress {
  state?: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
}

export interface DownloadActivity {
  state: "idle" | "active" | "complete" | "error";
  label: string;
  percent: number;
  etaSeconds?: number;
  speedBytesPerSecond?: number;
  capturedAt?: number | null;
}

export interface WatchProgressEntry {
  videoId: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
}

export type WatchProgressMap = Record<string, WatchProgressEntry>;
