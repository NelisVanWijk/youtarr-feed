import SwiftUI

struct OfflineScreen: View {
    @EnvironmentObject private var offlineLibrary: OfflineLibrary
    @EnvironmentObject private var downloadManager: OfflineDownloadManager
    @State private var selectedOffline: OfflineVideo?

    var body: some View {
        List {
            if !downloadManager.downloads.isEmpty {
                Section("Downloads") {
                    ForEach(Array(downloadManager.downloads.values).sorted { $0.title < $1.title }) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(item.title)
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(2)
                                Spacer()
                                Text(statusText(item))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            ProgressView(value: item.progress)
                        }
                    }
                }
            }

            Section("Offline") {
                if offlineLibrary.videos.isEmpty {
                    ContentUnavailableView(
                        "No offline videos",
                        systemImage: "iphone.slash",
                        description: Text("Download a server video offline to watch it without a connection.")
                    )
                } else {
                    ForEach(offlineLibrary.videos) { offline in
                        OfflineVideoRow(offline: offline) {
                            selectedOffline = offline
                        }
                        .swipeActions {
                            Button(role: .destructive) {
                                offlineLibrary.delete(offline)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Offline")
        .sheet(item: $selectedOffline) { offline in
            OfflinePlayerScreen(offline: offline)
        }
    }

    private func statusText(_ download: OfflineDownload) -> String {
        switch download.state {
        case .running:
            return "\(Int(download.progress * 100))%"
        case .finished:
            return "Done"
        case .failed:
            return "Failed"
        }
    }
}

struct OfflineVideoRow: View {
    let offline: OfflineVideo
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.secondary.opacity(0.16))
                    .frame(width: 96, height: 54)
                    .overlay {
                        Image(systemName: "play.fill")
                            .foregroundStyle(.secondary)
                    }

                VStack(alignment: .leading, spacing: 4) {
                    Text(offline.video.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    Text(offline.video.channelName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if offline.duration > 0 && offline.currentTime > 4 {
                        ProgressView(value: offline.currentTime / offline.duration)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }
}
