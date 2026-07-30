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
            title: "Lokaal",
            subtitle: "Alles wat Youtarr als gedownload ziet",
            videos: videos,
            query: $query,
            selectedVideo: $selectedVideo,
            emptyTitle: "Geen lokale video's",
            emptyMessage: "Gedownloade servervideo's verschijnen hier zodra Youtarr ze ziet."
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
