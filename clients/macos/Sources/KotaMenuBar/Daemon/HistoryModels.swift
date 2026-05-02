import Foundation

// Mirror of a single conversation summary returned by the daemon's
// `GET /api/history/search` route. Decoding is restricted to the eight
// fields the shared `renderHistorySearchPlain` helper consumes
// (`src/modules/history/render.ts` and the `ConversationRecord` shape
// in `src/core/modules/provider-types.ts:9-19`) so the macOS surface
// speaks the same line shape as Telegram, the CLI, and any other
// surface that consumes the helper. `source` is the only optional
// field, matching the upstream type one-to-one.
struct ConversationRecord: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let createdAt: String
    let updatedAt: String
    let model: String
    let messageCount: Int
    let cwd: String
    let source: String?
}

/// Renders conversation records one-to-one with the shared
/// `renderHistorySearchPlain` helper exported by
/// `src/modules/history/render.ts`.
func renderHistorySearchPlain(_ conversations: [ConversationRecord]) -> String {
    let idWidth = max(conversations.map { $0.id.count }.max() ?? 0, 2)
    return conversations.map { c in
        let id = c.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let updatedRaw = String(c.updatedAt.prefix(16)).replacingOccurrences(of: "T", with: " ")
        let updated = updatedRaw.padding(toLength: 16, withPad: " ", startingAt: 0)
        let countStr = String(c.messageCount)
        let countPadded = String(repeating: " ", count: max(0, 4 - countStr.count)) + countStr
        return "\(id)  \(updated)  \(countPadded) msgs  \(c.title)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `GET /api/history/search`
/// response. Strict decode so payload drift fails loudly instead of
/// silently degrading the rendered surface.
enum HistorySearchResponse: Decodable, Equatable {
    case success(conversations: [ConversationRecord])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, conversations, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let conversations = try container.decode([ConversationRecord].self, forKey: .conversations)
            self = .success(conversations: conversations)
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
                debugDescription: "Unknown history search reason: \(reason)"
            )
        }
    }
}
