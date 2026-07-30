import AVKit
import SwiftUI

struct VideoPlayerScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel

    let video: FeedVideo
    @State private var player = AVPlayer()
    @State private var observer: Any?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            PlayerContainer(player: player)
                .ignoresSafeArea()

            Button {
                saveProgress()
                player.pause()
                NowPlayingService.clear()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .padding()
        }
        .task {
            guard let url = model.streamURL(for: video) else { return }
            let item = AVPlayerItem(url: url)
            player.replaceCurrentItem(with: item)
            if let progress = model.progress[video.id], progress.currentTime > 5 {
                player.seek(to: CMTime(seconds: progress.currentTime, preferredTimescale: 600))
            }
            NowPlayingService.update(video: video, imageURL: model.imageURL(video.thumbnail), player: player)
            addObserver()
            player.play()
        }
        .onDisappear {
            saveProgress()
            removeObserver()
            player.pause()
        }
    }

    private func addObserver() {
        removeObserver()
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 5, preferredTimescale: 600),
            queue: .main
        ) { _ in
            saveProgress()
            NowPlayingService.update(video: video, imageURL: model.imageURL(video.thumbnail), player: player)
        }
    }

    private func removeObserver() {
        if let observer {
            player.removeTimeObserver(observer)
            self.observer = nil
        }
    }

    private func saveProgress() {
        let current = player.currentTime().seconds
        let duration = player.currentItem?.duration.seconds ?? video.duration
        model.saveProgress(video: video, currentTime: current, duration: duration)
    }
}

struct OfflinePlayerScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var offlineLibrary: OfflineLibrary

    let offline: OfflineVideo
    @State private var player = AVPlayer()
    @State private var observer: Any?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            PlayerContainer(player: player)
                .ignoresSafeArea()

            Button {
                saveProgress()
                player.pause()
                NowPlayingService.clear()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .padding()
        }
        .onAppear {
            let url = offlineLibrary.fileURL(for: offline)
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
            if offline.currentTime > 5 {
                player.seek(to: CMTime(seconds: offline.currentTime, preferredTimescale: 600))
            }
            NowPlayingService.update(video: offline.video, imageURL: nil, player: player)
            addObserver()
            player.play()
        }
        .onDisappear {
            saveProgress()
            removeObserver()
            player.pause()
        }
    }

    private func addObserver() {
        removeObserver()
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 5, preferredTimescale: 600),
            queue: .main
        ) { _ in
            saveProgress()
        }
    }

    private func removeObserver() {
        if let observer {
            player.removeTimeObserver(observer)
            self.observer = nil
        }
    }

    private func saveProgress() {
        let current = player.currentTime().seconds
        let duration = player.currentItem?.duration.seconds ?? offline.duration
        offlineLibrary.updateProgress(videoId: offline.id, currentTime: current, duration: duration)
        model.saveProgress(video: offline.video, currentTime: current, duration: duration, quiet: true)
    }
}

struct PlayerContainer: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        controller.entersFullScreenWhenPlaybackBegins = true
        controller.updatesNowPlayingInfoCenter = true
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        controller.player = player
    }
}
