import Foundation

extension DaemonClient {
    /// Targets the daemon's `GET /api/history/search?q=&semantic=true&limit=`
    /// route and decodes the discriminated `{ ok: true, conversations }` /
    /// `{ ok: false, reason: "semantic_unavailable" }` response. The query
    /// string is built via `URLComponents` so `q` is percent-encoded
    /// correctly. HTTP errors surface as `DaemonClientError.httpError` with
    /// the decoded JSON error body when the daemon supplied one.
    func searchHistory(query: String, limit: Int) async throws -> HistorySearchResponse {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/api/history/search"
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "semantic", value: "true"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        guard let url = components.url else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: HistorySearchResponse.self)
    }
}
