import Foundation

// Cross-store recall types. Mirrors the daemon's `RecallSource` /
// `RecallHit` / `RecallSearchResponse` exported from
// `src/core/server/kota-client.ts`. The wire shape is a discriminated
// union over `source`; the per-source payload carries the operator-
// facing metadata each surface renders.

/// Request body shape shared by `POST /recall` and `POST /answer`. The
/// daemon defines `AnswerFilter = RecallFilter` so the wire shape is
/// identical: `{ "query": <string>, "filter": { "topK"?, "minScore"?,
/// "sources"? } }`. Optional filter fields encode only when set so
/// each seam applies its own typed defaults.
struct RecallRequestFilter: Encodable {
    let topK: Int?
    let minScore: Double?
    let sources: [String]?
}

struct RecallRequestBody: Encodable {
    let query: String
    let filter: RecallRequestFilter
}

/// Mirror of one ranked, source-tagged hit returned by the daemon's
/// cross-store recall seam. Decoded as a Swift enum with associated
/// values so each arm carries exactly the fields its surface needs —
/// no nullable shape, no flattened struct that drifts from the
/// daemon's contract.
enum RecallHit: Decodable, Equatable {
    case knowledge(score: Double, id: String, title: String, preview: String, updated: String)
    case memory(score: Double, id: String, preview: String, created: String)
    case history(score: Double, id: String, title: String, cwd: String, updatedAt: String)
    case tasks(score: Double, id: String, title: String, state: String, priority: String, updatedAt: String)

    private enum CodingKeys: String, CodingKey {
        case source, score, id, title, preview, updated, created, cwd, updatedAt, state, priority
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let source = try container.decode(String.self, forKey: .source)
        let score = try container.decode(Double.self, forKey: .score)
        let id = try container.decode(String.self, forKey: .id)
        switch source {
        case "knowledge":
            let title = try container.decode(String.self, forKey: .title)
            let preview = try container.decode(String.self, forKey: .preview)
            let updated = try container.decode(String.self, forKey: .updated)
            self = .knowledge(score: score, id: id, title: title, preview: preview, updated: updated)
        case "memory":
            let preview = try container.decode(String.self, forKey: .preview)
            let created = try container.decode(String.self, forKey: .created)
            self = .memory(score: score, id: id, preview: preview, created: created)
        case "history":
            let title = try container.decode(String.self, forKey: .title)
            let cwd = try container.decode(String.self, forKey: .cwd)
            let updatedAt = try container.decode(String.self, forKey: .updatedAt)
            self = .history(score: score, id: id, title: title, cwd: cwd, updatedAt: updatedAt)
        case "tasks":
            let title = try container.decode(String.self, forKey: .title)
            let state = try container.decode(String.self, forKey: .state)
            let priority = try container.decode(String.self, forKey: .priority)
            let updatedAt = try container.decode(String.self, forKey: .updatedAt)
            self = .tasks(score: score, id: id, title: title, state: state, priority: priority, updatedAt: updatedAt)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .source,
                in: container,
                debugDescription: "Unknown recall hit source: \(source)"
            )
        }
    }

    var source: String {
        switch self {
        case .knowledge: return "knowledge"
        case .memory: return "memory"
        case .history: return "history"
        case .tasks: return "tasks"
        }
    }

    var id: String {
        switch self {
        case .knowledge(_, let id, _, _, _): return id
        case .memory(_, let id, _, _): return id
        case .history(_, let id, _, _, _): return id
        case .tasks(_, let id, _, _, _, _): return id
        }
    }

    var score: Double {
        switch self {
        case .knowledge(let score, _, _, _, _): return score
        case .memory(let score, _, _, _): return score
        case .history(let score, _, _, _, _): return score
        case .tasks(let score, _, _, _, _, _): return score
        }
    }

    var describe: String {
        switch self {
        case .knowledge(_, _, let title, _, _): return title
        case .memory(_, _, let preview, _): return preview
        case .history(_, _, let title, _, _): return title
        case .tasks(_, _, let title, let state, let priority, _): return "[\(state)/\(priority)] \(title)"
        }
    }
}

/// Renders cross-store recall hits one-to-one with the shared
/// `renderRecallHitsPlain` helper exported by
/// `src/modules/recall/render.ts`. An empty result returns the empty
/// string.
func renderRecallHitsPlain(_ hits: [RecallHit]) -> String {
    if hits.isEmpty { return "" }
    let sourceWidth = max(hits.map { $0.source.count }.max() ?? 0, 6)
    let idWidth = max(hits.map { $0.id.count }.max() ?? 0, 2)
    let scoreWidth = 5
    return hits.map { hit in
        let source = hit.source.padding(toLength: sourceWidth, withPad: " ", startingAt: 0)
        let scoreStr = String(format: "%.3f", hit.score)
        let score = String(repeating: " ", count: max(0, scoreWidth - scoreStr.count)) + scoreStr
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        return "\(source)  \(score)  \(id)  \(hit.describe)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `POST /recall` response.
/// Strict decode so payload drift fails loudly instead of silently
/// degrading the rendered surface.
enum RecallSearchResponse: Decodable, Equatable {
    case success(hits: [RecallHit])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, hits, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let hits = try container.decode([RecallHit].self, forKey: .hits)
            self = .success(hits: hits)
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
                debugDescription: "Unknown recall reason: \(reason)"
            )
        }
    }
}
