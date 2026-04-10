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

    func fetchRunDetail(runId: String) async throws -> RunDetail {
        try await get("/workflow/runs/\(runId)")
    }

    func triggerWorkflow(name: String) async throws -> TriggerResponse {
        let body = try JSONEncoder().encode(TriggerRequest(workflow: name))
        return try await post("/workflow/trigger", body: body)
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
}
