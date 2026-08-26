import Foundation

struct RecallRequestFilter: Encodable {
    let topK: Int?
    let minScore: Double?
    let sources: [String]?
}

struct RecallRequestBody: Encodable {
    let query: String
    let filter: RecallRequestFilter
}

extension RecallHit {
    var source: String {
        switch self {
        case .knowledge: return "knowledge"
        case .memory: return "memory"
        case .history: return "history"
        case .tasks: return "tasks"
        case .answer: return "answer"
        }
    }

    var id: String {
        switch self {
        case .knowledge(_, let id, _, _, _, _, _): return id
        case .memory(_, let id, _, _, _, _, _): return id
        case .history(_, let id, _, _, _): return id
        case .tasks(_, let id, _, _, _, _): return id
        case .answer(_, let id, _, _, _, _, _): return id
        }
    }

    var score: Double {
        switch self {
        case .knowledge(let score, _, _, _, _, _, _): return score
        case .memory(let score, _, _, _, _, _, _): return score
        case .history(let score, _, _, _, _): return score
        case .tasks(let score, _, _, _, _, _): return score
        case .answer(let score, _, _, _, _, _, _): return score
        }
    }

    var describe: String {
        switch self {
        case .knowledge(_, _, let title, _, _, let provenance, let freshness):
            return appendWorkMemoryMetadata(title, provenance: provenance, freshness: freshness)
        case .memory(_, _, let preview, _, _, let provenance, let freshness):
            return appendWorkMemoryMetadata(preview, provenance: provenance, freshness: freshness)
        case .history(_, _, let title, _, _): return title
        case .tasks(_, _, let title, let state, let priority, _): return "[\(state)/\(priority)] \(title)"
        case .answer(_, _, let query, _, let count, _, let result):
            switch result {
            case .success: return "[ok(\(Int(count)))] \(query)"
            case .failure(let reason): return "[\(reason.rawValue)] \(query)"
            }
        }
    }
}

func renderRecallHitsPlain(_ hits: [RecallHit]) -> String {
    guard !hits.isEmpty else { return "" }
    let sourceWidth = max(hits.map { $0.source.count }.max() ?? 0, 6)
    let idWidth = max(hits.map { $0.id.count }.max() ?? 0, 2)
    return hits.map { hit in
        let source = hit.source.padding(toLength: sourceWidth, withPad: " ", startingAt: 0)
        let score = String(format: "%5.3f", hit.score)
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        return "\(source)  \(score)  \(id)  \(hit.describe)"
    }.joined(separator: "\n")
}
