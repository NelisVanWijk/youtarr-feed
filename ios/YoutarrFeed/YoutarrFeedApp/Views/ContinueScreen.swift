import SwiftUI

struct ContinueScreen: View {
    @EnvironmentObject private var model: AppModel
    @State private var query = ""
    @State private var selectedVideo: FeedVideo?

    private var videos: [FeedVideo] {
        model.feedVideos
            .filter { video in
                guard let entry = model.progress[video.id], video.downloaded else { return false }
                return entry.duration > 0 && entry.currentTime > 5 && entry.currentTime < entry.duration - 8
            }
            .filter { video in
                query.isEmpty || "\(video.title) \(video.channelName)".localizedCaseInsensitiveContains(query)
            }
            .sorted { left, right in
                (model.progress[left.id]?.updatedAt ?? 0) > (model.progress[right.id]?.updatedAt ?? 0)
            }
    }

    var body: some View {
        VideoListScreen(
            title: "Continue Watching",
            subtitle: "Synced watch progress from your server",
            videos: videos,
            query: $query,
            selectedVideo: $selectedVideo,
            emptyTitle: "Nothing to continue",
            emptyMessage: "Start a downloaded video and it will appear here."
        )
    }
}
