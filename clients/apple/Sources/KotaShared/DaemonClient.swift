import Foundation

struct DaemonConnection: Equatable {
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

/// Daemon control HTTP client for native status, notifications, shared UI,
/// chat, and voice responsibilities. Operator capabilities use ui.surface.v1.
@MainActor
public final class DaemonClient {
    public init() {}
    private(set) var connection: DaemonConnection?
    let decoder = JSONDecoder()

    /// Append `scopeId=<id>` to a path. Used by every scope-scoped
    /// daemon route — the daemon's `resolveScopeIdParam` reads this
    /// query parameter and rejects unknown ids with a typed
    /// `UnknownScopeError` body. Pass `nil` (or omit) to call the
    /// route without scoping; the daemon resolves the registry's default.
    static func withScope(_ path: String, scopeId: String?) -> String {
        guard let scopeId, !scopeId.isEmpty,
              let encoded = scopeId.addingPercentEncoding(
                withAllowedCharacters: .urlQueryAllowed
              )
        else { return path }
        let separator = path.contains("?") ? "&" : "?"
        return "\(path)\(separator)scopeId=\(encoded)"
    }

    static func pathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    func refreshConnection(scopeRoot: URL) -> Bool {
        let controlPath = scopeRoot
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

    func fetchStatus(scopeId: String? = nil) async throws -> DaemonStatusResponse {
        try await get(Self.withScope("/status", scopeId: scopeId))
    }

    /// `GET /identity` — typed thin-client identity payload. Returns the
    /// scope the daemon is bound to, the daemon version, and the
    /// dashboard availability discriminator. Mirrors the TypeScript
    /// `ClientIdentity` contract one-to-one.
    func fetchIdentity() async throws -> ClientIdentity {
        try await get("/identity")
    }

    func fetchRecentRuns(limit: Int = 10, scopeId: String? = nil) async throws -> RunHistoryResponse {
        try await get(Self.withScope("/workflow/runs?limit=\(limit)", scopeId: scopeId))
    }

    func fetchSlashCommands() async throws -> SlashCommandsResponse {
        try await get("/commands")
    }

    func invokeSlashCommand(name: String) async throws -> InvokeCommandResponse {
        let body = try JSONEncoder().encode(InvokeCommandRequest(name: name))
        return try await post("/commands/invoke", body: body)
    }

    // MARK: - Internal helpers (used by per-namespace extensions)

    func throwIfHTTPError(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(
                status: http.statusCode,
                body: decodeDaemonErrorBody(from: data)
            )
        }
    }

    func decode<T: Decodable>(_ data: Data, as type: T.Type) throws -> T {
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw DaemonClientError.decodingError(description: String(describing: error))
        }
    }

    func routeURL(_ path: String, connection conn: DaemonConnection) -> URL {
        URL(string: path, relativeTo: conn.baseURL)!.absoluteURL
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: routeURL(path, connection: conn))
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: T.self)
    }

    @discardableResult
    func post<T: Decodable>(_ path: String, body: Data?) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: routeURL(path, connection: conn))
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

    func post(_ path: String, body: Data?) async throws {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: routeURL(path, connection: conn))
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
    }

    func patch<T: Decodable>(_ path: String, body: Data) async throws -> T {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: routeURL(path, connection: conn))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
        return try decode(data, as: T.self)
    }

    func delete(_ path: String) async throws {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: routeURL(path, connection: conn))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfHTTPError(response: response, data: data)
    }
}
