import SwiftUI

struct VideoListScreen<Header: View>: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var offlineLibrary: OfflineLibrary
    @EnvironmentObject private var downloadManager: OfflineDownloadManager

    let title: String
    let subtitle: String
    let videos: [FeedVideo]
    @Binding var query: String
    @Binding var selectedVideo: FeedVideo?
    let emptyTitle: String
    let emptyMessage: String
    let header: Header

    init(
        title: String,
        subtitle: String,
        videos: [FeedVideo],
        query: Binding<String>,
        selectedVideo: Binding<FeedVideo?>,
        emptyTitle: String = "Geen video's",
        emptyMessage: String = "Er is niets gevonden met deze filter.",
        @ViewBuilder header: () -> Header
    ) {
        self.title = title
        self.subtitle = subtitle
        self.videos = videos
        self._query = query
        self._selectedVideo = selectedVideo
        self.emptyTitle = emptyTitle
        self.emptyMessage = emptyMessage
        self.header = header()
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    header
                }
                .padding(.horizontal)
                .padding(.top, 8)

                if model.isLoading && videos.isEmpty {
                    ForEach(0..<6, id: \.self) { _ in
                        VideoCardSkeleton()
                            .padding(.horizontal)
                    }
                } else if videos.isEmpty {
                    ContentUnavailableView(
                        emptyTitle,
                        systemImage: "play.slash",
                        description: Text(emptyMessage)
                    )
                    .padding(.top, 80)
                } else {
                    ForEach(videos) { video in
                        VideoCard(
                            video: video,
                            source: model.streamSources[video.id],
                            progress: model.progressPercent(for: video),
                            isOffline: offlineLibrary.contains(video),
                            download: downloadManager.downloads[video.id],
                            onPlay: {
                                if video.downloaded {
                                    selectedVideo = video
                                } else {
                                    Task { await model.queueServerDownload(video) }
                                }
                            },
                            onServerDownload: {
                                Task { await model.queueServerDownload(video) }
                            },
                            onOfflineDownload: {
                                guard let url = model.streamURL(for: video) else { return }
                                downloadManager.start(video: video, streamURL: url)
                            },
                            onDelete: {
                                Task { await model.deleteServerDownload(video) }
                            }
                        )
                        .padding(.horizontal)
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .navigationTitle(title)
        .searchable(text: $query, prompt: "Zoeken")
        .refreshable {
            await model.refreshAll()
        }
        .fullScreenCover(item: $selectedVideo) { video in
            VideoPlayerScreen(video: video)
        }
    }
}

extension VideoListScreen where Header == EmptyView {
    init(
        title: String,
        subtitle: String,
        videos: [FeedVideo],
        query: Binding<String>,
        selectedVideo: Binding<FeedVideo?>,
        emptyTitle: String = "Geen video's",
        emptyMessage: String = "Er is niets gevonden met deze filter."
    ) {
        self.init(
            title: title,
            subtitle: subtitle,
            videos: videos,
            query: query,
            selectedVideo: selectedVideo,
            emptyTitle: emptyTitle,
            emptyMessage: emptyMessage
        ) {
            EmptyView()
        }
    }
}

struct VideoCard: View {
    @EnvironmentObject private var model: AppModel

    let video: FeedVideo
    let source: StreamSourceInfo?
    let progress: Double?
    let isOffline: Bool
    let download: OfflineDownload?
    let onPlay: () -> Void
    let onServerDownload: () -> Void
    let onOfflineDownload: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onPlay) {
                ZStack(alignment: .bottomLeading) {
                    AsyncImage(url: model.imageURL(video.thumbnail)) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFill()
                        default:
                            Rectangle()
                                .fill(Color.secondary.opacity(0.18))
                                .overlay {
                                    Image(systemName: "play.rectangle")
                                        .font(.title2)
                                        .foregroundStyle(.secondary)
                                }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            if video.downloaded {
                                SourceBadge(source: source)
                            } else {
                                Text("Nog ophalen")
                                    .badgeStyle(background: .orange)
                            }
                            if isOffline {
                                Text("Offline")
                                    .badgeStyle(background: .green)
                            }
                        }

                        if let progress {
                            ProgressView(value: progress)
                                .tint(.red)
                                .background(.black.opacity(0.2))
                        }
                    }
                    .padding(8)
                }
            }
            .buttonStyle(.plain)

            HStack(alignment: .top, spacing: 10) {
                AsyncImage(url: model.imageURL(video.channelAvatar)) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Circle().fill(Color.secondary.opacity(0.18))
                    }
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())

                VStack(alignment: .leading, spacing: 5) {
                    Text(video.title)
                        .font(.headline)
                        .lineLimit(2)
                    Text(video.channelName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if let download {
                        ProgressView(value: download.progress) {
                            Text(download.message ?? "Offline download")
                                .font(.caption)
                        }
                    }
                }

                Spacer(minLength: 4)

                Menu {
                    if video.downloaded {
                        Button(action: onPlay) {
                            Label("Afspelen", systemImage: "play.fill")
                        }
                        Button(action: onOfflineDownload) {
                            Label("Download offline", systemImage: "iphone.and.arrow.down")
                        }
                        Button(role: .destructive, action: onDelete) {
                            Label("Serverdownload verwijderen", systemImage: "trash")
                        }
                    } else {
                        Button(action: onServerDownload) {
                            Label("Download naar server", systemImage: "arrow.down.circle")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .symbolRenderingMode(.hierarchical)
                }
            }
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct SourceBadge: View {
    let source: StreamSourceInfo?

    var body: some View {
        if source?.source == "local" {
            Text("Direct")
                .badgeStyle(background: .green)
        } else if source?.source == "youtarr" {
            Text("Youtarr")
                .badgeStyle(background: .blue)
        } else {
            Text("Lokaal...")
                .badgeStyle(background: .gray)
        }
    }
}

struct VideoCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.secondary.opacity(0.14))
                .aspectRatio(16 / 9, contentMode: .fit)
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.secondary.opacity(0.12))
                .frame(height: 18)
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.secondary.opacity(0.08))
                .frame(width: 160, height: 14)
        }
        .redacted(reason: .placeholder)
    }
}

extension Text {
    func badgeStyle(background: Color) -> some View {
        self
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(background.opacity(0.92), in: Capsule())
    }
}
