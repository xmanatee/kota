import Foundation

struct DaemonConnection {
    let baseURL: URL
    let token: String
}

enum DaemonClientError: Error {
    case notConnected
    case httpError(Int)
    case decodingError(Error)
}

@MainActor
final class DaemonClient {
    private(set) var connection: DaemonConnection?
    private let decoder = JSONDecoder()

    func refreshConnection(projectDir: URL) -> Bool {
        let controlPath = projectDir
            .appendingPathComponent(".kota")
            .appendingPathComponent("daemon-control.json")
        guard
            let data = try? Data(contentsOf: controlPath),
            let control = try? decoder.decode(DaemonControlFile.self, from: data),
            let url = URL(string: "http://127.0.0.1:\(control.port)")
        else {
            connection = nil
            return false
        }
        connection = DaemonConnection(baseURL: url, token: control.token)
        return true
    }

    func fetchStatus() async throws -> DaemonStatusResponse {
        try await get("/status")
    }

    func fetchApprovals() async throws -> ApprovalsResponse {
        try await get("/approvals")
    }

    func approve(id: String) async throws {
        try await post("/approvals/\(id)/approve", body: nil as Data?)
    }

    func reject(id: String) async throws {
        try await post("/approvals/\(id)/reject", body: nil as Data?)
    }

    func fetchTasks() async throws -> TaskQueueResponse {
        try await get("/tasks")
    }

    func fetchSessions() async throws -> SessionsResponse {
        try await get("/sessions")
    }

    func fetchRecentRuns(limit: Int = 10) async throws -> RunHistoryResponse {
        try await get("/workflow/runs?limit=\(limit)")
    }

    func fetchRunDetail(runId: String) async throws -> RunDetail {
        try await get("/workflow/runs/\(runId)")
    }

    func triggerWorkflow(name: String) async throws -> TriggerResponse {
        let body = try JSONEncoder().encode(TriggerRequest(workflow: name))
        return try await post("/workflow/trigger", body: body)
    }

    func createSession() async throws -> String {
        let body = "{}".data(using: .utf8)
        let resp: CreateSessionResponse = try await post("/sessions", body: body)
        return resp.session_id
    }

    func deleteSession(id: String) async throws {
        try await delete("/sessions/\(id)")
    }

    /// Streams a chat response via SSE. The `onEvent` closure is called on the MainActor
    /// for each SSE event received. Resolves when the stream ends.
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
            throw DaemonClientError.httpError(http.statusCode)
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

    // MARK: - Private helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(http.statusCode)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw DaemonClientError.decodingError(error)
        }
    }

    @discardableResult
    private func post<T: Decodable>(_ path: String, body: Data?) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(http.statusCode)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw DaemonClientError.decodingError(error)
        }
    }

    private func post(_ path: String, body: Data?) async throws {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(http.statusCode)
        }
    }

    private func delete(_ path: String) async throws {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(http.statusCode)
        }
    }
}
