import SwiftUI

struct FeedScreen: View {
    enum Filter: String, CaseIterable, Identifiable {
        case all = "Alles"
        case new = "Nog ophalen"
        case downloaded = "Gedownload"

        var id: String { rawValue }
    }

    @EnvironmentObject private var model: AppModel
    @State private var filter: Filter = .all
    @State private var query = ""
    @State private var selectedVideo: FeedVideo?

    private var videos: [FeedVideo] {
        model.feedVideos.filter { video in
            if filter == .new && video.downloaded { return false }
            if filter == .downloaded && !video.downloaded { return false }
            if !query.isEmpty {
                return "\(video.title) \(video.channelName)"
                    .localizedCaseInsensitiveContains(query)
            }
            return true
        }
    }

    var body: some View {
        VideoListScreen(
            title: "Feed",
            subtitle: subtitle,
            videos: videos,
            query: $query,
            selectedVideo: $selectedVideo,
            header: {
                Picker("Filter", selection: $filter) {
                    ForEach(Filter.allCases) { item in
                        Text(item.rawValue).tag(item)
                    }
                }
                .pickerStyle(.segmented)
            }
        )
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.refreshAll() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink {
                    SettingsScreen()
                } label: {
                    Image(systemName: "gearshape")
                }
            }
        }
    }

    private var subtitle: String {
        if let status = model.status {
            return status.connected ? "Verbonden met \(status.server ?? model.normalizedServerURL)" : "Voorbeeldmodus"
        }
        return model.normalizedServerURL
    }
}
