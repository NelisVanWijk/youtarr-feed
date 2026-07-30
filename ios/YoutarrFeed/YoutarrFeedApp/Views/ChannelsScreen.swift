import SwiftUI

struct ChannelsScreen: View {
    @EnvironmentObject private var model: AppModel
    @State private var query = ""

    private var channels: [Channel] {
        model.channels.filter { channel in
            query.isEmpty || channel.name.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List {
            if channels.isEmpty {
                ContentUnavailableView(
                    "Geen kanalen",
                    systemImage: "rectangle.stack.badge.minus",
                    description: Text("Kanalen verschijnen hier zodra de server gekoppeld is.")
                )
            } else {
                ForEach(channels) { channel in
                    NavigationLink {
                        ChannelDetailScreen(channel: channel)
                    } label: {
                        ChannelRow(channel: channel)
                    }
                }
            }
        }
        .navigationTitle("Kanalen")
        .searchable(text: $query, prompt: "Kanaal zoeken")
        .refreshable {
            await model.refreshAll()
        }
    }
}

struct ChannelDetailScreen: View {
    @EnvironmentObject private var model: AppModel

    let channel: Channel
    @State private var query = ""
    @State private var selectedVideo: FeedVideo?

    private var videos: [FeedVideo] {
        (model.channelVideos[channel.id] ?? []).filter { video in
            query.isEmpty || video.title.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        VideoListScreen(
            title: channel.name,
            subtitle: channel.autoDownload ? "Automatisch downloaden staat aan" : "Tik op een video om hem op te halen",
            videos: videos,
            query: $query,
            selectedVideo: $selectedVideo,
            emptyTitle: "Geen video's",
            emptyMessage: "Dit kanaal heeft nog geen geladen video's."
        )
        .task {
            await model.loadChannel(channel)
        }
    }
}

struct ChannelRow: View {
    @EnvironmentObject private var model: AppModel

    let channel: Channel

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: model.imageURL(channel.avatar)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    Circle().fill(Color.secondary.opacity(0.18))
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(channel.name)
                    .font(.headline)
                Text(channel.autoDownload ? "Automatisch downloaden" : "Handmatig ophalen")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
