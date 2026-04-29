import Foundation

struct DaemonConnection {
    let baseURL: URL
    let token: String
}

/// Decoded form of the daemon's JSON error responses.
///
/// The daemon emits `{ error: "<message>" }` for plain HTTP errors and may
/// also include `code` (voice routes), `reason` (typed-failure shapes), or
/// `message` (free-form). When the body is not JSON the decoder leaves all
/// fields nil and the raw text is preserved separately.
struct DaemonErrorBody: Equatable {
    let error: String?
    let code: String?
    let reason: String?
    let message: String?
    let raw: String?

    /// Single human-facing line summarizing what the daemon said. Returns
    /// `nil` when the body had no recognizable text content.
    var displaySummary: String? {
        if let error, !error.isEmpty { return error }
        if let message, !message.isEmpty { return message }
        if let reason, !reason.isEmpty { return reason }
        if let raw, !raw.isEmpty { return raw }
        return nil
    }
}

enum DaemonClientError: Error, Equatable {
    /// No `DaemonConnection` is configured (no daemon-control file, no remote URL set).
    case notConnected
    /// Non-2xx HTTP response. `body` is decoded when the response carries JSON
    /// in the documented `{ error, code, reason, message }` shape; raw text is
    /// preserved otherwise.
    case httpError(status: Int, body: DaemonErrorBody?)
    /// 2xx response whose typed payload failed to decode. `description` is the
    /// underlying decoder message so tests and the UI can show what drifted.
    case decodingError(description: String)

    static func == (lhs: DaemonClientError, rhs: DaemonClientError) -> Bool {
        switch (lhs, rhs) {
        case (.notConnected, .notConnected):
            return true
        case (.httpError(let ls, let lb), .httpError(let rs, let rb)):
            return ls == rs && lb == rb
        case (.decodingError(let ld), .decodingError(let rd)):
            return ld == rd
        default:
            return false
        }
    }
}

extension DaemonClientError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "Daemon offline — no connection configured."
        case .httpError(let status, let body):
            return DaemonClientError.describeHTTPError(status: status, body: body)
        case .decodingError(let description):
            return "Daemon response did not match the expected shape: \(description)"
        }
    }

    /// Stable, operator-facing text for `httpError`. Exposed for tests and
    /// for callers that want to format `(status, body)` without re-throwing.
    static func describeHTTPError(status: Int, body: DaemonErrorBody?) -> String {
        let summary = body?.displaySummary
        let codeSuffix = (body?.code).flatMap { $0.isEmpty ? nil : " [\($0)]" } ?? ""
        switch status {
        case 401, 403:
            if let summary { return "Daemon rejected request (\(status)): \(summary)\(codeSuffix)" }
            return "Daemon rejected the request — token may be invalid or missing (HTTP \(status))."
        case 404:
            if let summary { return "Daemon endpoint not found: \(summary)\(codeSuffix)" }
            return "Daemon endpoint not found (HTTP 404)."
        case 409:
            if let summary { return "Daemon refused — conflict: \(summary)\(codeSuffix)" }
            return "Daemon refused the request — conflict (HTTP 409)."
        case 503:
            if let summary { return "Daemon unavailable: \(summary)\(codeSuffix)" }
            return "Daemon unavailable (HTTP 503)."
        case 500..<600:
            if let summary { return "Daemon error (\(status)): \(summary)\(codeSuffix)" }
            return "Daemon error (HTTP \(status))."
        default:
            if let summary { return "Daemon returned HTTP \(status): \(summary)\(codeSuffix)" }
            return "Daemon returned HTTP \(status)."
        }
    }
}

/// Decodes the daemon's JSON error envelope. Falls back to UTF-8 text when
/// the body is not JSON. Returns `nil` only when the body is empty.
func decodeDaemonErrorBody(from data: Data) -> DaemonErrorBody? {
    guard !data.isEmpty else { return nil }
    let raw = String(data: data, encoding: .utf8)
    guard
        let object = try? JSONSerialization.jsonObject(with: data),
        let dict = object as? [String: Any]
    else {
        return DaemonErrorBody(error: nil, code: nil, reason: nil, message: nil, raw: raw)
    }
    return DaemonErrorBody(
        error: dict["error"] as? String,
        code: dict["code"] as? String,
        reason: dict["reason"] as? String,
        message: dict["message"] as? String,
        raw: raw
    )
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

    /// `GET /identity` — typed thin-client identity payload. Returns the
    /// project the daemon is bound to, the daemon version, and the
    /// dashboard availability discriminator. Mirrors the TypeScript
    /// `ClientIdentity` contract one-to-one.
    func fetchIdentity() async throws -> ClientIdentity {
        try await get("/identity")
    }

    /// `GET /capabilities` — typed capability readiness payload. Each
    /// entry carries a stable id, status, optional reason code, and short
    /// operator-facing message. Clients should hide or disable controls
    /// for capabilities whose status is not `ready`.
    func fetchCapabilities() async throws -> CapabilityReadinessResponse {
        try await get("/capabilities")
    }

    /// `GET /workflow/definitions` — typed workflow definition catalog.
    /// Drives the workflow picker so the UI never asks the operator to
    /// type a free-text workflow name.
    func fetchWorkflowDefinitions() async throws -> WorkflowDefinitionsResponse {
        try await get("/workflow/definitions")
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
    /// correctly. HTTP errors surface as `DaemonClientError.httpError` with
    /// the decoded JSON error body when the daemon supplied one.
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
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: KnowledgeSearchResponse.self)
    }

    /// Targets the daemon's `GET /api/memory/search?q=&semantic=true&limit=`
    /// route and decodes the discriminated `{ ok: true, entries }` /
    /// `{ ok: false, reason: "semantic_unavailable" }` response. The query
    /// string is built via `URLComponents` so `q` is percent-encoded
    /// correctly. HTTP errors surface as `DaemonClientError.httpError` with
    /// the decoded JSON error body when the daemon supplied one.
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
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: MemorySearchResponse.self)
    }

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

    /// Targets the daemon's `GET /tasks/search?q=&semantic=true&limit=` daemon
    /// control route (not under `/api/`) and decodes the discriminated
    /// `{ ok: true, tasks }` / `{ ok: false, reason: "semantic_unavailable" }`
    /// response. The query string is built via `URLComponents` so `q` is
    /// percent-encoded correctly. When `states` is provided, each value is
    /// appended as a repeated `state=<value>` query item, matching the route
    /// handler's `url.searchParams.getAll("state")` behavior. HTTP errors
    /// surface as `DaemonClientError.httpError` with the decoded JSON error
    /// body when the daemon supplied one.
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

    /// Targets the daemon's `POST /recall` daemon-control route (not under
    /// `/api/`) and decodes the discriminated `{ ok: true, hits }` /
    /// `{ ok: false, reason: "semantic_unavailable" }` response. The request
    /// body is built via `JSONEncoder` against `RecallRequestBody`, which
    /// only emits optional filter fields (`topK`, `minScore`, `sources`)
    /// when set so the seam applies its own typed defaults
    /// (`RECALL_DEFAULT_TOP_K = 20`, no min-score floor, every registered
    /// contributor). HTTP errors surface as `DaemonClientError.httpError`
    /// with the decoded JSON error body when the daemon supplied one.
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

    /// Targets the daemon's `POST /answer` daemon-control route (not under
    /// `/api/`) and decodes the discriminated four-arm `AnswerResult`:
    /// one synthesized-success arm carrying `answer`, `citations`, and the
    /// typed `RecallHit[]` they resolve against, plus three `ok: false`
    /// failure arms (`no_hits`, `semantic_unavailable`, `synthesis_failed`).
    /// The request body is built via `JSONEncoder` against the shared
    /// `RecallRequestBody`, which only emits optional filter fields
    /// (`topK`, `minScore`, `sources`) when set so the seam applies its own
    /// typed defaults. HTTP errors surface as `DaemonClientError.httpError`
    /// with the decoded JSON error body when the daemon supplied one.
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

    /// Targets the daemon's `POST /capture` daemon-control route (not under
    /// `/api/`) and decodes the discriminated four-arm `CaptureResult`:
    /// one `ok: true` arm carrying the typed `CaptureRecord`, plus three
    /// `ok: false` failure arms (`ambiguous`, `no_contributors`,
    /// `contributor_failed`). The request body is built via `JSONEncoder`
    /// against `CaptureRequestBody`, which only emits the optional
    /// `filter` object when at least one filter field is set, and only
    /// emits per-field keys (`target`, `hint`) when those are set so the
    /// seam applies its own typed defaults (classifier picks the target;
    /// no hint passed to the prompt). HTTP errors surface as
    /// `DaemonClientError.httpError` with the decoded JSON error body when
    /// the daemon supplied one.
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

    /// Targets the daemon's `POST /retract` daemon-control route (not under
    /// `/api/`) and decodes the discriminated four-arm `RetractResult`:
    /// one `ok: true` arm carrying the typed `RetractRecord`, plus three
    /// `ok: false` failure arms (`no_contributors`, `not_found`,
    /// `contributor_failed`). The request body is built via `JSONEncoder`
    /// against `RetractRequest`, which encodes the discriminated
    /// `{ "target": <string>, ...identifier }` wire shape so the type
    /// system rejects passing an inbox `path` alongside a memory `id` at
    /// compile time. HTTP errors surface as `DaemonClientError.httpError`
    /// with the decoded JSON error body when the daemon supplied one.
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

    // MARK: - Private helpers

    private func throwIfHTTPError(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(
                status: http.statusCode,
                body: decodeDaemonErrorBody(from: data)
            )
        }
    }

    private func decode<T: Decodable>(_ data: Data, as type: T.Type) throws -> T {
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw DaemonClientError.decodingError(description: String(describing: error))
        }
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: T.self)
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
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: T.self)
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
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
    }

    private func patch<T: Decodable>(_ path: String, body: Data) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: T.self)
    }

    private func delete(_ path: String) async throws {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: conn.baseURL.appendingPathComponent(path))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
    }
}
