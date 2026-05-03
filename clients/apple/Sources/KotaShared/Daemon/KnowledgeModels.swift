import Foundation

// Mirror of a single entry returned by the daemon's
// `GET /api/knowledge/search` route. Decoding is restricted to the four
// fields the shared `renderKnowledgeSearchPlain` helper consumes
// (`src/modules/knowledge/render.ts`) so the macOS surface speaks the
// same line shape as Telegram, the CLI, and the web `KnowledgePanel`.
struct KnowledgeEntry: Codable, Identifiable, Equatable {
    let id: String
    let type: String
    let status: String
    let title: String
}

/// Renders knowledge entries one-to-one with the shared
/// `renderKnowledgeSearchPlain` helper exported by
/// `src/modules/knowledge/render.ts`: id, type, status, and title columns
/// padded to the widest value across the result set.
func renderKnowledgeSearchPlain(_ entries: [KnowledgeEntry]) -> String {
    let idWidth = max(entries.map { $0.id.count }.max() ?? 0, 2)
    let typeWidth = max(entries.map { $0.type.count }.max() ?? 0, 4)
    let statusWidth = max(entries.map { $0.status.count }.max() ?? 0, 6)
    return entries.map { e in
        let id = e.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let type = e.type.padding(toLength: typeWidth, withPad: " ", startingAt: 0)
        let status = e.status.padding(toLength: statusWidth, withPad: " ", startingAt: 0)
        return "\(id)  \(type)  \(status)  \(e.title)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `GET /api/knowledge/search`
/// response: success carries the entries; `semantic_unavailable` is
/// returned when no embedding-backed knowledge provider is configured.
/// Strict decode so payload drift fails loudly.
enum KnowledgeSearchResponse: Decodable, Equatable {
    case success(entries: [KnowledgeEntry])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, entries, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let entries = try container.decode([KnowledgeEntry].self, forKey: .entries)
            self = .success(entries: entries)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "semantic_unavailable":
            self = .semanticUnavailable
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown knowledge search reason: \(reason)"
            )
        }
    }
}
