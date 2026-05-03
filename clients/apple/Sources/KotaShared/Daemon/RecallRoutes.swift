import Foundation

extension DaemonClient {
    /// Targets the daemon's `POST /recall` daemon-control route (not under
    /// `/api/`) and decodes the discriminated `{ ok: true, hits }` /
    /// `{ ok: false, reason: "semantic_unavailable" }` response. The
    /// request body is built via `JSONEncoder` against `RecallRequestBody`,
    /// which only emits optional filter fields (`topK`, `minScore`,
    /// `sources`) when set so the seam applies its own typed defaults
    /// (`RECALL_DEFAULT_TOP_K = 20`, no min-score floor, every registered
    /// contributor).
    func recall(
        query: String,
        topK: Int?,
        minScore: Double?,
        sources: [String]?
    ) async throws -> RecallSearchResponse {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/recall"
        guard let url = components.url else { throw DaemonClientError.notConnected }
        let body = try JSONEncoder().encode(
            RecallRequestBody(
                query: query,
                filter: RecallRequestFilter(topK: topK, minScore: minScore, sources: sources)
            )
        )
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: RecallSearchResponse.self)
    }
}
