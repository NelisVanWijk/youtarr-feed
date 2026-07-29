export type AppMode = "live" | "demo";

export interface FeedStatus {
  mode: AppMode;
  connected: boolean;
  message: string;
  server?: string;
  plexConfigured?: boolean;
  plexServer?: string;
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
}

export interface FeedResponse {
  mode: AppMode;
  videos: FeedVideo[];
  channels: Channel[];
  warnings?: string[];
}
