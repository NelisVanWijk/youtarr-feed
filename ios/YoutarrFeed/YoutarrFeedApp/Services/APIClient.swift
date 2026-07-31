import Foundation

struct APIClient {
    var baseURL: URL
    var session: URLSession = .shared

    func status() async throws -> FeedStatus {
        try await get("/api/status")
    }

    func feed() async throws -> FeedResponse {
        try await get("/api/feed")
    }

    func localVideos() async throws -> LocalVideosResponse {
        try await get("/api/local-videos")
    }

    func channelVideos(channelId: String, page: Int = 1) async throws -> ChannelVideosResponse {
        try await get("/api/channels/\(channelId)?page=\(page)")
    }

    func watchProgress() async throws -> WatchProgressResponse {
        try await get("/api/watch-progress")
    }

    func saveWatchProgress(videoId: String, currentTime: Double, duration: Double) async throws -> WatchProgressResponse {
        try await send(
            "/api/watch-progress",
            method: "POST",
            body: [
                "videoId": videoId,
                "currentTime": currentTime,
                "duration": duration
            ]
        )
    }

    func queueServerDownload(videoId: String) async throws {
        let _: EmptyResponse = try await send("/api/download", method: "POST", body: ["id": videoId])
    }

    func deleteServerDownload(videoId: String) async throws {
        let _: EmptyResponse = try await send("/api/delete", method: "POST", body: ["id": videoId])
    }

    func activity() async throws -> DownloadActivity {
        try await get("/api/activity")
    }

    func streamSource(videoId: String) async throws -> StreamSourceInfo {
        try await get("/api/stream/\(videoId)/source")
    }

    func streamURL(videoId: String) -> URL {
        makeURL("/api/stream/\(videoId)")
    }

    func imageURL(_ path: String) -> URL? {
        if path.hasPrefix("http://") || path.hasPrefix("https://") {
            return URL(string: path)
        }
        guard path.hasPrefix("/") else { return nil }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let request = URLRequest(url: makeURL(path))
        return try await decode(request)
    }

    private func send<T: Decodable>(
        _ path: String,
        method: String,
        body: [String: Any]
    ) async throws -> T {
        var request = URLRequest(url: makeURL(path))
        request.httpMethod = method
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await decode(request)
    }

    private func decode<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            let error = try? JSONDecoder.youtarr.decode(APIErrorResponse.self, from: data)
            throw APIClientError.server(error?.error ?? "Server returned HTTP \(http.statusCode)")
        }
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder.youtarr.decode(T.self, from: data)
    }

    private func makeURL(_ path: String) -> URL {
        if let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.union(.urlQueryAllowed)) {
            return URL(string: encoded, relativeTo: baseURL)!.absoluteURL
        }
        return URL(string: path, relativeTo: baseURL)!.absoluteURL
    }
}

struct EmptyResponse: Codable {}

enum APIClientError: LocalizedError {
    case invalidResponse
    case invalidBaseURL
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid server response"
        case .invalidBaseURL:
            return "Server URL is invalid"
        case .server(let message):
            return message
        }
    }
}

extension JSONDecoder {
    static var youtarr: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    static var youtarr: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
