import Foundation

final class OfflineDownloadManager: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = OfflineDownloadManager()

    @Published private(set) var downloads: [String: OfflineDownload] = [:]

    private var pendingVideos: [String: FeedVideo] = [:]
    private let pendingStoreKey = "offlineDownloadPendingVideos"

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(
            withIdentifier: "nl.nielsvanwijk.youtarrfeed.offline-downloads"
        )
        configuration.allowsCellularAccess = true
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private override init() {
        super.init()
        restorePendingVideos()
    }

    @MainActor
    func start(video: FeedVideo, streamURL: URL) {
        if OfflineLibrary.shared.contains(video) {
            downloads[video.id] = OfflineDownload(
                id: video.id,
                title: video.title,
                progress: 1,
                state: .finished,
                message: "Already offline"
            )
            return
        }

        pendingVideos[video.id] = video
        savePendingVideos()

        var request = URLRequest(url: streamURL)
        request.addValue("bytes=0-", forHTTPHeaderField: "Range")

        let task = session.downloadTask(with: request)
        task.taskDescription = video.id
        downloads[video.id] = OfflineDownload(
            id: video.id,
            title: video.title,
            progress: 0,
            state: .running,
            message: nil
        )
        task.resume()
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard let videoId = downloadTask.taskDescription else { return }
        let progress: Double
        if totalBytesExpectedToWrite > 0 {
            progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        } else {
            progress = 0
        }

        Task { @MainActor in
            guard var item = downloads[videoId] else { return }
            item.progress = progress
            downloads[videoId] = item
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard
            let videoId = downloadTask.taskDescription,
            let video = pendingVideos[videoId]
        else { return }

        do {
            let temporary = try copyToTemporaryFile(location: location, task: downloadTask, videoId: videoId)
            Task { @MainActor in
                do {
                    try OfflineLibrary.shared.add(video: video, downloadedFile: temporary)
                    finish(videoId: videoId, message: "Saved offline")
                } catch {
                    fail(videoId: videoId, message: error.localizedDescription)
                }
            }
        } catch {
            Task { @MainActor in
                fail(videoId: videoId, message: error.localizedDescription)
            }
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let error, let videoId = task.taskDescription else { return }
        Task { @MainActor in
            fail(videoId: videoId, message: error.localizedDescription)
        }
    }

    @MainActor
    private func finish(videoId: String, message: String) {
        if var item = downloads[videoId] {
            item.progress = 1
            item.state = .finished
            item.message = message
            downloads[videoId] = item
        }
        pendingVideos.removeValue(forKey: videoId)
        savePendingVideos()
    }

    @MainActor
    private func fail(videoId: String, message: String) {
        if var item = downloads[videoId] {
            item.state = .failed
            item.message = message
            downloads[videoId] = item
        }
        pendingVideos.removeValue(forKey: videoId)
        savePendingVideos()
    }

    private func copyToTemporaryFile(location: URL, task: URLSessionDownloadTask, videoId: String) throws -> URL {
        let extensionFromResponse = task.response?.suggestedFilename?
            .split(separator: ".")
            .last
            .map(String.init)
        let fileExtension = extensionFromResponse?.isEmpty == false ? extensionFromResponse! : "mp4"
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(videoId)-\(UUID().uuidString).\(fileExtension)")
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.copyItem(at: location, to: destination)
        return destination
    }

    private func restorePendingVideos() {
        guard
            let data = UserDefaults.standard.data(forKey: pendingStoreKey),
            let videos = try? JSONDecoder.youtarr.decode([String: FeedVideo].self, from: data)
        else { return }
        pendingVideos = videos
    }

    private func savePendingVideos() {
        guard let data = try? JSONEncoder.youtarr.encode(pendingVideos) else { return }
        UserDefaults.standard.set(data, forKey: pendingStoreKey)
    }
}
