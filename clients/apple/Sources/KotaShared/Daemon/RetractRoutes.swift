import Foundation

extension DaemonClient {
    /// Targets the daemon's `POST /retract` daemon-control route (not under
    /// `/api/`) and decodes the discriminated four-arm `RetractResult`.
    /// The request body is built via `JSONEncoder` against `RetractRequest`,
    /// which encodes the discriminated `{ "target": <string>, ...identifier }`
    /// wire shape so the type system rejects passing an inbox `path`
    /// alongside a memory `id` at compile time.
    func retract(request: RetractRequest) async throws -> RetractResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/retract"
        guard let url = components.url else { throw DaemonClientError.notConnected }
        let body = try JSONEncoder().encode(request)
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: RetractResult.self)
    }
}
