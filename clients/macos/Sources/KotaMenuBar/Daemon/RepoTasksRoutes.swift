import Foundation

extension DaemonClient {
    /// Targets the daemon's `GET /tasks/search?q=&semantic=true&limit=`
    /// daemon control route (not under `/api/`) and decodes the
    /// discriminated `{ ok: true, tasks }` / `{ ok: false, reason: "semantic_unavailable" }`
    /// response. When `states` is provided, each value is appended as a
    /// repeated `state=<value>` query item, matching the route handler's
    /// `url.searchParams.getAll("state")` behavior.
    func searchTasks(query: String, limit: Int, states: [String]?) async throws -> TasksSearchResponse {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/tasks/search"
        var items: [URLQueryItem] = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "semantic", value: "true"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let states {
            for state in states {
                items.append(URLQueryItem(name: "state", value: state))
            }
        }
        components.queryItems = items
        guard let url = components.url else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: TasksSearchResponse.self)
    }
}
