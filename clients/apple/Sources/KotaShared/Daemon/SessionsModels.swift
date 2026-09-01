import Foundation

// Chat slash-command transport remains native because it composes with the
// local text and voice interaction surface. Its fetch lifecycle uses the
// shared Swift resource owner in AppState.

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
