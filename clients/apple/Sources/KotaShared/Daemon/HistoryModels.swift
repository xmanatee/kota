import Foundation

// Mirror of a single conversation summary returned by the daemon's
// `GET /api/history/search` route. Decoding is restricted to the eight
// fields the shared `renderHistorySearchPlain` helper consumes
// (`src/modules/history/render.ts` and the `ConversationRecord` shape
// in `src/core/modules/provider-types.ts:9-19`) so the macOS surface
// speaks the same line shape as Telegram, the CLI, and any other
// surface that consumes the helper. `source` is the only optional
// field, matching the upstream type one-to-one.
//
// `source` decodes through a closed `"user" | "action"` set: any other
// value is a typed decode failure rather than a silently-accepted
// future value. The mobile decoder
// (`clients/mobile/src/daemon/history.ts:103-109`) and the cross-client
// conformance decoder (`clients/conformance/decoders.ts`
// `parseHistorySearchResponse`) enforce the same closed set so a
// future-source addition is a coordinated contract bump on every
// visual surface, not a quiet drift.
struct ConversationRecord: Codable, Identifiable, Equatable {
    static let allowedSources: Set<String> = ["user", "action"]

    let id: String
    let title: String
    let createdAt: String
    let updatedAt: String
    let model: String
    let messageCount: Int
    let cwd: String
    let source: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, createdAt, updatedAt, model, messageCount, cwd, source
    }

    init(
        id: String,
        title: String,
        createdAt: String,
        updatedAt: String,
        model: String,
        messageCount: Int,
        cwd: String,
        source: String?
    ) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.model = model
        self.messageCount = messageCount
        self.cwd = cwd
        self.source = source
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.title = try container.decode(String.self, forKey: .title)
        self.createdAt = try container.decode(String.self, forKey: .createdAt)
        self.updatedAt = try container.decode(String.self, forKey: .updatedAt)
        self.model = try container.decode(String.self, forKey: .model)
        self.messageCount = try container.decode(Int.self, forKey: .messageCount)
        self.cwd = try container.decode(String.self, forKey: .cwd)
        if let raw = try container.decodeIfPresent(String.self, forKey: .source) {
            guard Self.allowedSources.contains(raw) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .source,
                    in: container,
                    debugDescription: "Unknown conversation source: \(raw)"
                )
            }
            self.source = raw
        } else {
            self.source = nil
        }
    }
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
