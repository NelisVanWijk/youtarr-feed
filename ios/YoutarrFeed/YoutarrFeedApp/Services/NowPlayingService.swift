import AVFoundation
import MediaPlayer
import UIKit

enum NowPlayingService {
    static func update(video: FeedVideo, imageURL: URL?, player: AVPlayer) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: video.title,
            MPMediaItemPropertyArtist: video.channelName
        ]

        if let item = player.currentItem {
            let duration = item.asset.duration.seconds
            if duration.isFinite {
                info[MPMediaItemPropertyPlaybackDuration] = duration
            }
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = player.currentTime().seconds
        info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        guard let imageURL else { return }
        Task.detached {
            guard
                let data = try? Data(contentsOf: imageURL),
                let image = UIImage(data: data)
            else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            await MainActor.run {
                var updated = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? info
                updated[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = updated
            }
        }
    }

    static func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
}
