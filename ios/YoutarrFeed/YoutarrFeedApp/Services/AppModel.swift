import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var serverURL: String {
        didSet {
            UserDefaults.standard.set(serverURL, forKey: Self.serverURLKey)
        }
    }

    @Published var status: FeedStatus?
    @Published var feedVideos: [FeedVideo] = []
    @Published var channels: [Channel] = []
    @Published var localVideos: [FeedVideo] = []
    @Published var channelVideos: [String: [FeedVideo]] = [:]
    @Published var progress: [String: WatchProgressEntry] = [:]
    @Published var streamSources: [String: StreamSourceInfo] = [:]
    @Published var activity: DownloadActivity?
    @Published var isLoading = false
    @Published var message: String?

    private static let serverURLKey = "serverURL"

    init() {
        serverURL = UserDefaults.standard.string(forKey: Self.serverURLKey) ?? "http://localhost:3090"
    }

    var api: APIClient? {
        guard let url = URL(string: normalizedServerURL) else { return nil }
        return APIClient(baseURL: url)
    }

    var normalizedServerURL: String {
        let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "http://localhost:3090" }
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            return trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
        return "http://\(trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/")))"
    }

    func refreshAll() async {
        guard let api else {
            message = APIClientError.invalidBaseURL.localizedDescription
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            async let status = api.status()
            async let feed = api.feed()
            async let progress = api.watchProgress()
            async let local = api.localVideos()

            let loadedStatus = try await status
            let loadedFeed = try await feed
            let loadedProgress = try await progress
            let loadedLocal = try await local

            self.status = loadedStatus
            self.feedVideos = loadedFeed.videos
            self.channels = loadedFeed.channels
            self.progress = loadedProgress.progress
            self.localVideos = loadedLocal.videos
            await loadSources(for: loadedFeed.videos + loadedLocal.videos)
        } catch {
            message = error.localizedDescription
        }
    }

    func refreshLocal() async {
        guard let api else { return }
        do {
            let response = try await api.localVideos()
            localVideos = response.videos
            await loadSources(for: response.videos)
        } catch {
            message = error.localizedDescription
        }
    }

    func loadChannel(_ channel: Channel) async {
        guard let api else { return }
        do {
            let response = try await api.channelVideos(channelId: channel.id)
            channelVideos[channel.id] = response.videos
            await loadSources(for: response.videos)
        } catch {
            message = error.localizedDescription
        }
    }

    func loadSources(for videos: [FeedVideo]) async {
        guard let api else { return }
        let candidates = Array(Set(videos.filter { $0.downloaded }.map(\.id))).filter { streamSources[$0] == nil }
        guard !candidates.isEmpty else { return }

        await withTaskGroup(of: (String, StreamSourceInfo?).self) { group in
            for id in candidates.prefix(80) {
                group.addTask {
                    do {
                        return (id, try await api.streamSource(videoId: id))
                    } catch {
                        return (id, nil)
                    }
                }
            }

            for await result in group {
                if let source = result.1 {
                    streamSources[result.0] = source
                }
            }
        }
    }

    func queueServerDownload(_ video: FeedVideo) async {
        guard let api else { return }
        do {
            try await api.queueServerDownload(videoId: video.id)
            message = "Download started in Youtarr"
            await refreshActivity()
        } catch {
            message = error.localizedDescription
        }
    }

    func deleteServerDownload(_ video: FeedVideo) async {
        guard let api else { return }
        do {
            try await api.deleteServerDownload(videoId: video.id)
            feedVideos.removeAll { $0.id == video.id }
            localVideos.removeAll { $0.id == video.id }
            progress.removeValue(forKey: video.id)
            await refreshAll()
        } catch {
            message = error.localizedDescription
        }
    }

    func refreshActivity() async {
        guard let api else { return }
        do {
            activity = try await api.activity()
        } catch {
            activity = nil
        }
    }

    func streamURL(for video: FeedVideo) -> URL? {
        api?.streamURL(videoId: video.id)
    }

    func imageURL(_ path: String) -> URL? {
        api?.imageURL(path)
    }

    func progressPercent(for video: FeedVideo) -> Double? {
        guard let entry = progress[video.id], entry.duration > 0 else { return nil }
        return min(0.98, max(0.02, entry.currentTime / entry.duration))
    }

    func saveProgress(video: FeedVideo, currentTime: Double, duration: Double, quiet: Bool = false) {
        guard currentTime.isFinite, duration.isFinite, duration > 0 else { return }
        let entry = WatchProgressEntry(
            videoId: video.id,
            currentTime: currentTime,
            duration: duration,
            updatedAt: Date().timeIntervalSince1970
        )

        if duration - currentTime < 8 || currentTime < 2 {
            progress.removeValue(forKey: video.id)
        } else {
            progress[video.id] = entry
        }

        Task {
            guard let api else { return }
            do {
                let response = try await api.saveWatchProgress(
                    videoId: video.id,
                    currentTime: currentTime,
                    duration: duration
                )
                await MainActor.run {
                    self.progress = response.progress
                }
            } catch {
                await MainActor.run {
                    if !quiet {
                        self.message = error.localizedDescription
                    }
                }
            }
        }
    }
}
