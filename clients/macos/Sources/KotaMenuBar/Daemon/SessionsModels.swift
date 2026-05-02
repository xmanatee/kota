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

struct TriggerRequest: Codable {
    let workflow: String
}

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
