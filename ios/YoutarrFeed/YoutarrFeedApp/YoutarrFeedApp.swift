import AVFoundation
import SwiftUI

@main
struct YoutarrFeedApp: App {
    @StateObject private var model = AppModel()

    init() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .moviePlayback,
                policy: .longFormVideo,
                options: [.allowAirPlay]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Audio session setup failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(OfflineLibrary.shared)
                .environmentObject(OfflineDownloadManager.shared)
        }
    }
}
