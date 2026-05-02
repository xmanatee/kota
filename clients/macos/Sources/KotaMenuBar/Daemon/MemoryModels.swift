import Foundation

// Mirror of a single entry returned by the daemon's
// `GET /api/memory/search` route. Decoding is restricted to the three
// fields the shared `renderMemorySearchPlain` helper consumes
// (`src/modules/memory/render.ts` and the `MemoryListEntry` shape in
// `src/core/server/kota-client.ts`) so the macOS surface speaks the
// same line shape as Telegram, the CLI, and any other surface that
// consumes the helper.
struct MemoryEntry: Codable, Identifiable, Equatable {
    let id: String
    let created: String
    let content: String
}

/// Renders memory entries one-to-one with the shared
/// `renderMemorySearchPlain` helper exported by
/// `src/modules/memory/render.ts`: id (padded to widest), created date
/// sliced to `YYYY-MM-DD HH:MM` (16 chars), and a 60-char snippet of
/// the content with newlines collapsed to single spaces.
func renderMemorySearchPlain(_ entries: [MemoryEntry]) -> String {
    let idWidth = max(entries.map { $0.id.count }.max() ?? 0, 2)
    return entries.map { e in
        let id = e.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let dateRaw = String(e.created.prefix(16)).replacingOccurrences(of: "T", with: " ")
        let date = dateRaw.padding(toLength: 16, withPad: " ", startingAt: 0)
        let collapsed = e.content.replacingOccurrences(of: "\n", with: " ")
        let snippet = String(collapsed.prefix(60))
        return "\(id)  \(date)  \(snippet)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `GET /api/memory/search`
/// response. Strict decode so payload drift fails loudly instead of
/// silently degrading the rendered surface.
enum MemorySearchResponse: Decodable, Equatable {
    case success(entries: [MemoryEntry])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, entries, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let entries = try container.decode([MemoryEntry].self, forKey: .entries)
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
                debugDescription: "Unknown memory search reason: \(reason)"
            )
        }
    }
}
