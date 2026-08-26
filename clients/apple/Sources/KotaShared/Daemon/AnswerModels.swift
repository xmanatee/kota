import Foundation

func renderAnswerCitationsPlain(
    _ citations: [AnswerCitation],
    hits: [RecallHit]
) -> String {
    guard !citations.isEmpty else { return "" }
    let byKey = Dictionary(uniqueKeysWithValues: hits.map { ("\($0.source):\($0.id)", $0) })
    let rows = citations.compactMap { byKey["\($0.source.rawValue):\($0.id)"] }
    return renderRecallHitsPlain(rows)
}

struct AnswerHistoryListFilter: Encodable, Equatable {
    let limit: Int?
    let beforeId: String?
}
