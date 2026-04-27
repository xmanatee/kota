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

    func setRemoteConnection(url: URL, token: String) {
        connection = DaemonConnection(baseURL: url, token: token)
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

    func fetchOwnerQuestions() async throws -> OwnerQuestionsResponse {
        try await get("/owner-questions")
    }

    func answerOwnerQuestion(id: String, answer: String) async throws {
        let body = try JSONEncoder().encode(["answer": answer])
        try await post("/owner-questions/\(id)/answer", body: body)
    }

    func dismissOwnerQuestion(id: String, reason: String?) async throws {
        let body: Data?
        if let reason = reason {
            body = try JSONEncoder().encode(["reason": reason])
        } else {
            body = nil
        }
        try await post("/owner-questions/\(id)/dismiss", body: body)
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

    func fetchSlashCommands() async throws -> SlashCommandsResponse {
        try await get("/commands")
    }

    func fetchDigest() async throws -> DigestResponse {
        try await get("/api/digest")
    }

    func fetchAttention() async throws -> AttentionResponse {
        try await get("/api/attention")
    }

    /// Targets the daemon's `GET /api/knowledge/search?q=&semantic=true&limit=`
    /// route and decodes the discriminated `{ ok: true, entries }` /
    /// `{ ok: false, reason: "semantic_unavailable" }` response. The query
    /// string is built via `URLComponents` so `q` is percent-encoded
    /// correctly. HTTP errors surface one-to-one as
    /// `DaemonClientError.httpError`.
    func searchKnowledge(query: String, limit: Int) async throws -> KnowledgeSearchResponse {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/api/knowledge/search"
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "semantic", value: "true"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        guard let url = components.url else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(http.statusCode)
        }
        do {
            return try decoder.decode(KnowledgeSearchResponse.self, from: data)
        } catch {
            throw DaemonClientError.decodingError(error)
        }
    }

    /// Targets the daemon's `GET /api/memory/search?q=&semantic=true&limit=`
    /// route and decodes the discriminated `{ ok: true, entries }` /
    /// `{ ok: false, reason: "semantic_unavailable" }` response. The query
    /// string is built via `URLComponents` so `q` is percent-encoded
    /// correctly. HTTP errors surface one-to-one as
    /// `DaemonClientError.httpError`.
    func searchMemory(query: String, limit: Int) async throws -> MemorySearchResponse {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        guard var components = URLComponents(url: conn.baseURL, resolvingAgainstBaseURL: false) else {
            throw DaemonClientError.notConnected
        }
        components.path = "/api/memory/search"
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "semantic", value: "true"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        guard let url = components.url else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(http.statusCode)
        }
        do {
            return try decoder.decode(MemorySearchResponse.self, from: data)
        } catch {
            throw DaemonClientError.decodingError(error)
        }
    }

    /// Targets the daemon's `GET /api/history/search?q=&semantic=true&limit=`
    /// route and decodes the discriminated `{ ok: true, conversations }` /
    /// `{ ok: false, reason: "semantic_unavailable" }` response. The query
    /// string is built via `URLComponents` so `q` is percent-encoded
    /// correctly. HTTP errors surface one-to-one as
    /// `DaemonClientError.httpError`.
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
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(http.statusCode)
        }
        do {
            return try decoder.decode(HistorySearchResponse.self, from: data)
        } catch {
            throw DaemonClientError.decodingError(error)
        }
    }

    func invokeSlashCommand(name: String) async throws -> InvokeCommandResponse {
        let body = try JSONEncoder().encode(InvokeCommandRequest(name: name))
        return try await post("/commands/invoke", body: body)
    }

    func createSession(autonomyMode: AutonomyMode? = nil) async throws -> String {
        let body = try JSONEncoder().encode(CreateSessionRequest(autonomy_mode: autonomyMode))
        let resp: CreateSessionResponse = try await post("/sessions", body: body)
        return resp.session_id
    }

    func deleteSession(id: String) async throws {
        try await delete("/sessions/\(id)")
    }

    func setSessionAutonomyMode(id: String, mode: AutonomyMode) async throws -> SetAutonomyModeResponse {
        let body = try JSONEncoder().encode(SetAutonomyModeRequest(autonomy_mode: mode))
        return try await patch("/sessions/\(id)", body: body)
    }

    /// Posts captured audio to `/voice/transcribe` and decodes the typed
    /// success or failure shape. Failures preserve the daemon's `code`
    /// (`stt-unavailable`, `stt-failed`, …) so the UI can render the same
    /// vocabulary the CLI and web client use.
    func voiceTranscribe(
        audio: Data,
        mimeType: String,
        filename: String? = nil,
        languageHint: String? = nil
    ) async throws -> VoiceTranscribeResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var payload: [String: Any] = [
            "audioBase64": audio.base64EncodedString(),
            "mimeType": mimeType,
        ]
        if let filename { payload["filename"] = filename }
        if let languageHint { payload["languageHint"] = languageHint }
        let body = try JSONSerialization.data(withJSONObject: payload)

        var request = URLRequest(url: conn.baseURL.appendingPathComponent("/voice/transcribe"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if !(200..<300).contains(status) {
            return .failure(failureFromPayload(status: status, payload: parsed))
        }
        let text = parsed["text"] as? String ?? ""
        let language = parsed["language"] as? String
        return .success(text: text, language: language)
    }

    /// Posts text to `/voice/synthesize` and decodes the typed success or
    /// failure shape. The success branch returns raw audio bytes plus mime
    /// and format so callers can hand both to a platform player.
    func voiceSynthesize(
        text: String,
        voice: String? = nil,
        languageHint: String? = nil,
        format: String? = nil
    ) async throws -> VoiceSynthesizeResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var payload: [String: Any] = ["text": text]
        if let voice { payload["voice"] = voice }
        if let languageHint { payload["languageHint"] = languageHint }
        if let format { payload["format"] = format }
        let body = try JSONSerialization.data(withJSONObject: payload)

        var request = URLRequest(url: conn.baseURL.appendingPathComponent("/voice/synthesize"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if !(200..<300).contains(status) {
            return .failure(failureFromPayload(status: status, payload: parsed))
        }
        let audioBase64 = parsed["audioBase64"] as? String ?? ""
        guard let audio = Data(base64Encoded: audioBase64) else {
            return .failure(VoiceFailure(
                status: status,
                error: "Daemon returned malformed audioBase64",
                code: "tts-malformed-response",
                supportedFormats: nil
            ))
        }
        let mimeType = parsed["mimeType"] as? String ?? "application/octet-stream"
        let format = parsed["format"] as? String ?? ""
        return .success(audio: audio, mimeType: mimeType, format: format)
    }

    private func failureFromPayload(status: Int, payload: [String: Any]) -> VoiceFailure {
        let error = (payload["error"] as? String) ?? "HTTP \(status)"
        let code = payload["code"] as? String
        let supported = (payload["supported"] as? [String])
            ?? (payload["supported"] as? [Any])?.compactMap { $0 as? String }
        return VoiceFailure(status: status, error: error, code: code, supportedFormats: supported)
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

    private func patch<T: Decodable>(_ path: String, body: Data) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
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
