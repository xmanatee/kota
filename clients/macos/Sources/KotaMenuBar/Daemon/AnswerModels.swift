import Foundation

// Cited-answer types and answer-history mirrors. Mirrors the daemon's
// `AnswerCitation` / `AnswerResult` / `AnswerHistory*` exported from
// `src/core/server/kota-client.ts`.

/// Mirror of the daemon's `AnswerCitation` shape:
/// `{ source: RecallSource, id: string }`. Each citation is keyed by
/// the same `{ source, id }` discriminator as the underlying
/// `RecallHit` so the response is always reconstructable against the
/// `hits` list — no free-form prose pointers, no hallucinated sources.
struct AnswerCitation: Codable, Equatable {
    let source: String
    let id: String
}

/// Renders cited-answer citations one-to-one with the shared
/// `renderAnswerCitationsPlain` helper exported by
/// `src/modules/answer/render.ts`. An empty citation list — or a list
/// whose every entry fails to resolve — returns the empty string.
func renderAnswerCitationsPlain(
    _ citations: [AnswerCitation],
    hits: [RecallHit]
) -> String {
    if citations.isEmpty { return "" }
    var byKey: [String: RecallHit] = [:]
    for hit in hits {
        byKey["\(hit.source):\(hit.id)"] = hit
    }
    let rows: [RecallHit] = citations.compactMap { byKey["\($0.source):\($0.id)"] }
    if rows.isEmpty { return "" }
    let sourceWidth = max(rows.map { $0.source.count }.max() ?? 0, 6)
    let idWidth = max(rows.map { $0.id.count }.max() ?? 0, 2)
    let scoreWidth = 5
    return rows.map { hit in
        let source = hit.source.padding(toLength: sourceWidth, withPad: " ", startingAt: 0)
        let scoreStr = String(format: "%.3f", hit.score)
        let score = String(repeating: " ", count: max(0, scoreWidth - scoreStr.count)) + scoreStr
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        return "\(source)  \(score)  \(id)  \(hit.describe)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `POST /answer` response: one
/// synthesized-success arm carrying `answer`, `citations`, and the
/// typed `RecallHit[]` they resolve against, plus three `ok: false`
/// failure arms tagged by `reason`. Strict decode so payload drift
/// fails loudly instead of silently degrading the rendered surface.
enum AnswerResult: Decodable, Equatable {
    case success(answer: String, citations: [AnswerCitation], hits: [RecallHit])
    case noHits
    case semanticUnavailable
    case synthesisFailed

    private enum CodingKeys: String, CodingKey {
        case ok, answer, citations, hits, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let answer = try container.decode(String.self, forKey: .answer)
            let citations = try container.decode([AnswerCitation].self, forKey: .citations)
            let hits = try container.decode([RecallHit].self, forKey: .hits)
            self = .success(answer: answer, citations: citations, hits: hits)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "no_hits":
            self = .noHits
        case "semantic_unavailable":
            self = .semanticUnavailable
        case "synthesis_failed":
            self = .synthesisFailed
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown answer reason: \(reason)"
            )
        }
    }
}

// MARK: - Answer history

/// Mirror of the daemon's `AnswerHistoryEntry`. Compact projection of
/// one persisted `AnswerProvider.answer(query)` call, with the result
/// discriminated so a caller cannot accidentally read fields that only
/// exist on the success branch.
struct AnswerHistoryEntry: Decodable, Equatable, Identifiable {
    enum Result: Decodable, Equatable {
        case success(citationCount: Int)
        case noHits
        case semanticUnavailable
        case synthesisFailed

        private enum CodingKeys: String, CodingKey {
            case ok, citationCount, reason
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let ok = try container.decode(Bool.self, forKey: .ok)
            if ok {
                let citationCount = try container.decode(Int.self, forKey: .citationCount)
                self = .success(citationCount: citationCount)
                return
            }
            let reason = try container.decode(String.self, forKey: .reason)
            switch reason {
            case "no_hits": self = .noHits
            case "semantic_unavailable": self = .semanticUnavailable
            case "synthesis_failed": self = .synthesisFailed
            default:
                throw DecodingError.dataCorruptedError(
                    forKey: .reason,
                    in: container,
                    debugDescription: "Unknown answer history entry reason: \(reason)"
                )
            }
        }
    }

    let id: String
    let createdAt: String
    let query: String
    let result: Result
}

/// Mirror of the daemon's `AnswerHistoryListResult`.
struct AnswerHistoryListResult: Decodable, Equatable {
    let entries: [AnswerHistoryEntry]
}

/// Filter accepted by `DaemonClient.answerLog`. Mirror of the daemon's
/// `AnswerHistoryListFilter`.
struct AnswerHistoryListFilter: Encodable, Equatable {
    let limit: Int?
    let beforeId: String?
}

/// Mirror of the daemon's `AnswerHistoryRecord`. One persisted envelope
/// per `AnswerProvider.answer(query, filter?)` call regardless of `ok`,
/// carrying the original query verbatim, the post-default filter
/// actually used, the typed `RecallHit[]` the synthesizer was shown,
/// and the discriminated `AnswerResult` envelope the caller saw.
struct AnswerHistoryRecord: Decodable, Equatable, Identifiable {
    let id: String
    let createdAt: String
    let query: String
    let filter: RecallRequestFilterDecoded
    let recallHits: [RecallHit]
    let result: AnswerResult
}

/// Decode-side mirror of `RecallRequestFilter`. The encode-side struct
/// lives near the recall request body and only emits set keys on the
/// wire; this struct is the read-side counterpart used by
/// `AnswerHistoryRecord` so the store-snapshot decode path stays
/// symmetric.
struct RecallRequestFilterDecoded: Decodable, Equatable {
    let topK: Int?
    let minScore: Double?
    let sources: [String]?
}

/// Discriminated mirror of the daemon's `AnswerHistoryShowResult`.
/// Strict decode so payload drift fails loudly instead of silently
/// degrading the rendered surface to a misleading "loading…" state.
enum AnswerHistoryShowResult: Decodable, Equatable {
    case success(record: AnswerHistoryRecord)
    case notFound

    private enum CodingKeys: String, CodingKey {
        case ok, record, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let record = try container.decode(AnswerHistoryRecord.self, forKey: .record)
            self = .success(record: record)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "not_found":
            self = .notFound
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown answer history show reason: \(reason)"
            )
        }
    }
}
