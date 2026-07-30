import Foundation

@MainActor
final class OfflineLibrary: ObservableObject {
    static let shared = OfflineLibrary()

    @Published private(set) var videos: [OfflineVideo] = []

    private let fileManager = FileManager.default
    private let libraryFileName = "offline-library.json"
    private let folderName = "OfflineVideos"

    private init() {
        load()
    }

    var folderURL: URL {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let folder = documents.appendingPathComponent(folderName, isDirectory: true)
        if !fileManager.fileExists(atPath: folder.path) {
            try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return folder
    }

    func fileURL(for offline: OfflineVideo) -> URL {
        folderURL.appendingPathComponent(offline.relativePath)
    }

    func add(video: FeedVideo, downloadedFile: URL) throws {
        let fileExtension = downloadedFile.pathExtension.isEmpty ? "mp4" : downloadedFile.pathExtension
        let fileName = "\(video.id).\(fileExtension)"
        let destination = folderURL.appendingPathComponent(fileName)

        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: downloadedFile, to: destination)

        videos.removeAll { $0.id == video.id }
        videos.insert(
            OfflineVideo(
                id: video.id,
                video: video,
                relativePath: fileName,
                downloadedAt: Date(),
                currentTime: 0,
                duration: video.duration
            ),
            at: 0
        )
        save()
    }

    func updateProgress(videoId: String, currentTime: Double, duration: Double) {
        guard let index = videos.firstIndex(where: { $0.id == videoId }) else { return }
        if duration - currentTime < 8 {
            videos[index].currentTime = 0
        } else {
            videos[index].currentTime = currentTime
        }
        videos[index].duration = duration
        save()
    }

    func delete(_ offline: OfflineVideo) {
        let url = fileURL(for: offline)
        if fileManager.fileExists(atPath: url.path) {
            try? fileManager.removeItem(at: url)
        }
        videos.removeAll { $0.id == offline.id }
        save()
    }

    func contains(_ video: FeedVideo) -> Bool {
        videos.contains { $0.id == video.id }
    }

    private var libraryURL: URL {
        folderURL.appendingPathComponent(libraryFileName)
    }

    private func load() {
        guard let data = try? Data(contentsOf: libraryURL) else {
            videos = []
            return
        }
        videos = (try? JSONDecoder.youtarr.decode([OfflineVideo].self, from: data)) ?? []
    }

    private func save() {
        guard let data = try? JSONEncoder.youtarr.encode(videos) else { return }
        try? data.write(to: libraryURL, options: [.atomic])
    }
}
