import Foundation

extension DaemonClient {
    /// Streams a chat response via SSE. The `onEvent` closure is called on
    /// the MainActor for each SSE event received. Resolves when the
    /// stream ends.
    func streamChat(sessionId: String, message: String, onEvent: @escaping (String, Data) -> Void) async throws {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        let url = conn.baseURL.appendingPathComponent("/sessions/\(sessionId)/chat")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["message": message])

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            // SSE bodies cannot be drained twice through `bytes`; surface a
            // body-less HTTP error rather than blocking on a partial read.
            throw DaemonClientError.httpError(status: http.statusCode, body: nil)
        }

        var currentEvent = ""
        for try await line in bytes.lines {
            if line.hasPrefix("event: ") {
                currentEvent = String(line.dropFirst(7))
            } else if line.hasPrefix("data: "), let data = String(line.dropFirst(6)).data(using: .utf8) {
                onEvent(currentEvent, data)
            } else if line.isEmpty {
                currentEvent = ""
            }
        }
    }
}
