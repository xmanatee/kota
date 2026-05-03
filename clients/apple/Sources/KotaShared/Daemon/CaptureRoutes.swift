import Foundation

extension DaemonClient {
    /// Targets the daemon's `POST /capture` daemon-control route (not under
    /// `/api/`) and decodes the discriminated four-arm `CaptureResult`.
    /// The request body is built via `JSONEncoder` against
    /// `CaptureRequestBody`, which only emits the optional `filter` object
    /// when at least one filter field is set, and only emits per-field
    /// keys (`target`, `hint`) when those are set.
    func capture(
        text: String,
        target: CaptureTarget?,
        hint: String?
    ) async throws -> CaptureResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/capture"
        guard let url = components.url else { throw DaemonClientError.notConnected }
        let filter: CaptureRequestFilter? = (target == nil && hint == nil)
            ? nil
            : CaptureRequestFilter(target: target, hint: hint)
        let body = try JSONEncoder().encode(CaptureRequestBody(text: text, filter: filter))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: CaptureResult.self)
    }
}
