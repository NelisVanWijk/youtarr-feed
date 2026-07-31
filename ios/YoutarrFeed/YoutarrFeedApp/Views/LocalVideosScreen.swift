import SwiftUI

struct LocalVideosScreen: View {
    @EnvironmentObject private var model: AppModel
    @State private var query = ""
    @State private var selectedVideo: FeedVideo?

    private var videos: [FeedVideo] {
        model.localVideos.filter { video in
            query.isEmpty || "\(video.title) \(video.channelName)".localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        VideoListScreen(
            title: "Local",
            subtitle: "Everything Youtarr sees as downloaded",
            videos: videos,
            query: $query,
            selectedVideo: $selectedVideo,
            emptyTitle: "No local videos",
            emptyMessage: "Downloaded server videos appear here once Youtarr sees them."
        )
        .task {
            await model.refreshLocal()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.refreshLocal() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
    }
}
