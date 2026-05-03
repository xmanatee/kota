import Foundation

// Interactive session and autonomy-mode shapes (creation, autonomy
// mode, slash commands, workflow trigger).

// MARK: - Autonomy mode

enum AutonomyMode: String, Codable, CaseIterable, Identifiable {
    case passive
    case supervised
    case autonomous

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

// MARK: - Chat session creation

struct CreateSessionResponse: Codable {
    let session_id: String
    let autonomy_mode: AutonomyMode?
}

struct CreateSessionRequest: Codable {
    let autonomy_mode: AutonomyMode?
}

struct SetAutonomyModeRequest: Codable {
    let autonomy_mode: AutonomyMode
}

struct SetAutonomyModeResponse: Codable {
    let session_id: String
    let autonomy_mode: AutonomyMode
    let source: String?
    let serveOwned: Bool?
}

// MARK: - Trigger

/// Daemon `POST /workflow/trigger` request body. The daemon's typed
/// contract reads `name` (validator regex `/^[a-zA-Z0-9_-]+$/`) and an
/// optional `payload` object that is merged into the synthetic `manual`
/// trigger payload. `payload` is carried as raw JSON `Data` so the macOS
/// surface can validate the operator's pasted JSON once and forward it
/// byte-for-byte without round-tripping through a permissive enum.
struct TriggerRequest {
    let name: String
    let payload: Data?

    /// Render the wire body. Validates that `payload` (when present) is
    /// a JSON object; the daemon ignores arrays and primitives so the
    /// macOS surface refuses them up-front instead of silently dropping
    /// them.
    func wireBody() throws -> Data {
        var dict: [String: Any] = ["name": name]
        if let payload {
            let parsed = try JSONSerialization.jsonObject(with: payload, options: [])
            guard parsed is [String: Any] else {
                throw TriggerRequestError.payloadNotObject
            }
            dict["payload"] = parsed
        }
        return try JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys])
    }
}

enum TriggerRequestError: Error, LocalizedError, Equatable {
    case payloadNotObject

    var errorDescription: String? {
        switch self {
        case .payloadNotObject:
            return "Workflow payload must be a JSON object."
        }
    }
}

/// Daemon `POST /workflow/trigger` response envelope. The daemon emits
/// `{ ok: true, queued: <name>, runId: <id> }` for typed enqueues; older
/// pending-only paths can omit `runId`, so it stays optional.
struct TriggerResponse: Codable {
    let runId: String?
}

// MARK: - Sessions

struct SessionsResponse: Codable {
    let sessions: [SessionSummary]
}

struct SessionSummary: Codable, Identifiable {
    let id: String
    let createdAt: String
    let lastActive: Double
    let autonomyMode: AutonomyMode
    let source: String?

    var elapsedDescription: String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: createdAt) else { return "" }
        let seconds = Int(-date.timeIntervalSinceNow)
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return "\(h)h \(m)m"
    }
}

// MARK: - Slash commands

struct SlashCommandsResponse: Codable {
    let commands: [SlashCommand]
}

struct SlashCommand: Codable, Identifiable {
    let name: String
    let label: String
    let description: String?
    let source: String
    let module: String

    var id: String { name }
}

struct InvokeCommandRequest: Codable {
    let name: String
}

enum InvokeCommandResponse: Decodable {
    case workflow(queued: String, runId: String?)
    case skill(prompt: String)

    enum CodingKeys: String, CodingKey {
        case kind, queued, runId, prompt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "workflow":
            let queued = try container.decode(String.self, forKey: .queued)
            let runId = try container.decodeIfPresent(String.self, forKey: .runId)
            self = .workflow(queued: queued, runId: runId)
        case "skill":
            let prompt = try container.decode(String.self, forKey: .prompt)
            self = .skill(prompt: prompt)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "Unknown command action kind: \(kind)"
            )
        }
    }
}
