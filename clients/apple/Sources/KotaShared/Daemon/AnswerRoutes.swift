import Foundation

extension DaemonClient {
    /// Targets the daemon's `POST /answer` daemon-control route (not under
    /// `/api/`) and decodes the discriminated four-arm `AnswerResult`. The
    /// request body is built via `JSONEncoder` against the shared
    /// `RecallRequestBody`, which only emits optional filter fields
    /// (`topK`, `minScore`, `sources`) when set so the seam applies its
    /// own typed defaults.
    func answer(
        query: String,
        topK: Int?,
        minScore: Double?,
        sources: [String]?
    ) async throws -> AnswerResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/answer"
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
        return try decode(data, as: AnswerResult.self)
    }

    /// Targets the daemon's `GET /answers` daemon-control route — the
    /// same route the web `AnswerHistoryPanel`, mobile `AnswerHistoryScreen`,
    /// Telegram `/answer-log`, and `kota answer log` CLI consume. Decodes
    /// the typed `AnswerHistoryListResult`. The optional `beforeId`
    /// cursor and `limit` are emitted as query params only when set so
    /// the daemon store applies its own typed defaults.
    func answerLog(
        filter: AnswerHistoryListFilter
    ) async throws -> AnswerHistoryListResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/answers"
        var queryItems: [URLQueryItem] = []
        if let limit = filter.limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let beforeId = filter.beforeId {
            queryItems.append(URLQueryItem(name: "beforeId", value: beforeId))
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: AnswerHistoryListResult.self)
    }

    /// Targets the daemon's `GET /answers/:id` daemon-control route and
    /// decodes the discriminated `AnswerHistoryShowResult`. The id is
    /// percent-encoded for path use (mirroring the mobile client's
    /// `encodeURIComponent(id)`) so a record id with reserved characters
    /// round-trips correctly without escaping into a sibling segment.
    func answerShow(id: String) async throws -> AnswerHistoryShowResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.percentEncodedPath = "/answers/\(encoded)"
        guard let url = components.url else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: AnswerHistoryShowResult.self)
    }
}
