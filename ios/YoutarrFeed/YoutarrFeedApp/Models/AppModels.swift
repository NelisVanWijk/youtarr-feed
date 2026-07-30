import Foundation

enum AppMode: String, Codable {
    case live
    case demo
}

struct FeedStatus: Codable {
    let mode: AppMode
    let connected: Bool
    let message: String
    let server: String?
    let plexConfigured: Bool?
    let plexServer: String?
}

struct Channel: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let url: String
    let avatar: String
    let autoDownload: Bool
    let videoQuality: String?
}

struct FeedVideo: Identifiable, Codable, Hashable {
    let id: String
    let channelId: String
    let channelName: String
    let channelAvatar: String
    let title: String
    let thumbnail: String
    let publishedAt: String?
    let duration: Double
    var downloaded: Bool
    let missing: Bool
    let watched: Bool
    let removedFromYouTube: Bool?
}

struct FeedResponse: Codable {
    let mode: AppMode
    let videos: [FeedVideo]
    let channels: [Channel]
    let warnings: [String]?
}

struct ChannelVideosResponse: Codable {
    let mode: AppMode
    let channel: Channel
    let videos: [FeedVideo]
}

struct LocalVideosResponse: Codable {
    let mode: AppMode
    let channels: [Channel]
    let videos: [FeedVideo]
    let warnings: [String]?
}

struct WatchProgressEntry: Codable, Hashable {
    let videoId: String
    let currentTime: Double
    let duration: Double
    let updatedAt: Double
}

struct WatchProgressResponse: Codable {
    let progress: [String: WatchProgressEntry]
}

struct DownloadActivity: Codable {
    let state: String
    let label: String
    let percent: Double
    let etaSeconds: Double?
    let speedBytesPerSecond: Double?
    let capturedAt: Double?
}

struct StreamSourceInfo: Codable, Hashable {
    let source: String
    let local: LocalMediaStatus?
    let youtarrConfigured: Bool?
}

struct LocalMediaStatus: Codable, Hashable {
    let configured: Bool?
    let available: Bool
    let fileName: String?
    let size: Int64?
    let extensionName: String?

    enum CodingKeys: String, CodingKey {
        case configured
        case available
        case fileName
        case size
        case extensionName = "extension"
    }
}

struct APIErrorResponse: Codable {
    let error: String?
}

struct OfflineVideo: Identifiable, Codable, Hashable {
    let id: String
    var video: FeedVideo
    var relativePath: String
    var downloadedAt: Date
    var currentTime: Double
    var duration: Double
}

struct OfflineDownload: Identifiable, Hashable {
    enum State: String {
        case running
        case finished
        case failed
    }

    let id: String
    var title: String
    var progress: Double
    var state: State
    var message: String?
}
