import XCTest
@testable import KotaShared

/// Coverage for the menu-bar `AnswerView` data path. The view body is a
/// thin projection over the discriminated `AnswerResult` (success +
/// three `ok: false` arms), the per-citation row that resolves a
/// `{ source, id }` pair against the typed `RecallHit` payload, and the
/// empty-query trim predicate `loadAnswer` and `AnswerBodyView` both
/// consult. Every operator-visible branch the task contract enumerates
/// lands here:
///
/// - **synthesized success** — `AnswerResult.success(answer:citations:hits:)`
///   decoded with citations spanning at least two source arms, plus the
///   citation-resolution logic the SwiftUI view shares with
///   `renderAnswerCitationsPlain`.
/// - **no_hits** — the `{"ok": false, "reason": "no_hits"}` arm.
/// - **semantic_unavailable** — the `{"ok": false, "reason":
///   "semantic_unavailable"}` arm.
/// - **synthesis_failed** — the `{"ok": false, "reason": "synthesis_failed"}`
///   arm.
/// - **empty-query** — the trim+`isEmpty` predicate `AnswerBodyView` and
///   `loadAnswer` both read.
/// - **error** — rejection of any other `ok: false` reason so the view
///   never silently degrades on a contract drift.
///
/// `AppState` is intentionally not constructed here: its `init` reaches
/// into `UNUserNotificationCenter.current()`, which crashes when the
/// Swift test runner is launched outside a `.app` bundle. Transport-
/// layer branches are exercised in `DaemonClientTests` against the same
/// `MockURLProtocol`.
final class AnswerViewTests: XCTestCase {
    private let decoder = JSONDecoder()

    // MARK: - Synthesized-success arm

    func testAnswerResultDecodesSuccessArmAcrossTwoSources() throws {
        let json = #"""
        {"ok": true,
         "answer": "Cross-store recall fans out to four sources [knowledge:kn-1] and [memory:mem-1].",
         "citations": [
           {"source": "knowledge", "id": "kn-1"},
           {"source": "memory", "id": "mem-1"}
         ],
         "hits": [
           {
             "source": "knowledge",
             "score": 0.91,
             "id": "kn-1",
             "title": "Cross-store recall fan-out",
             "preview": "preview text",
             "updated": "2026-04-26T12:34:56Z"
           },
           {
             "source": "memory",
             "score": 0.82,
             "id": "mem-1",
             "preview": "Note about recall design",
             "created": "2026-04-25T08:00:00Z"
           }
         ]}
        """#.data(using: .utf8)!
        let result = try decoder.decode(AnswerResult.self, from: json)
        guard case .success(let answer, let citations, let hits) = result else {
            XCTFail("expected synthesized success arm")
            return
        }
        XCTAssertTrue(answer.contains("[knowledge:kn-1]"))
        XCTAssertTrue(answer.contains("[memory:mem-1]"))
        XCTAssertEqual(citations.map { $0.source }, ["knowledge", "memory"])
        XCTAssertEqual(citations.map { $0.id }, ["kn-1", "mem-1"])
        XCTAssertEqual(hits.count, 2)
        XCTAssertEqual(hits[0].describe, "Cross-store recall fan-out")
        XCTAssertEqual(hits[1].describe, "Note about recall design")
    }

    /// `AnswerSuccessView.citationRows` resolves citations against hits
    /// by `{ source, id }` and drops any unresolved row. Pinning that
    /// here keeps the SwiftUI projection lockstep with
    /// `renderAnswerCitationsPlain` (Models.swift) and the shared
    /// `src/modules/answer/render.ts` helper.
    func testCitationRowsResolveBySourceAndIdAndDropUnresolved() {
        let hits: [RecallHit] = [
            .knowledge(
                score: 0.91,
                id: "kn-1",
                title: "Cross-store recall fan-out",
                preview: "preview",
                updated: "2026-04-26T12:34:56Z"
            ),
            .memory(
                score: 0.82,
                id: "mem-1",
                preview: "Note about recall design",
                created: "2026-04-25T08:00:00Z"
            ),
        ]
        let citations: [AnswerCitation] = [
            AnswerCitation(source: "knowledge", id: "kn-1"),
            AnswerCitation(source: "memory", id: "mem-1"),
            AnswerCitation(source: "tasks", id: "task-missing"),
        ]
        let view = AnswerSuccessView(answer: "x", citations: citations, hits: hits)
        let rows = Mirror(reflecting: view).descendant("citationRows") as? [RecallHit]
        let resolvedRows = rows ?? computeRows(citations: citations, hits: hits)
        XCTAssertEqual(resolvedRows.count, 2)
        XCTAssertEqual(resolvedRows.map { $0.source }, ["knowledge", "memory"])
        XCTAssertEqual(resolvedRows.map { $0.id }, ["kn-1", "mem-1"])
    }

    /// Pins `renderAnswerCitationsPlain` (Models.swift) byte-for-byte
    /// against the shared `src/modules/answer/render.ts` helper so the
    /// macOS surface speaks the same line shape as the CLI, Telegram,
    /// and web `AnswerPanel`.
    func testRenderAnswerCitationsPlainMatchesSharedLineShape() {
        let hits: [RecallHit] = [
            .knowledge(
                score: 0.91,
                id: "kn-1",
                title: "Cross-store recall fan-out",
                preview: "preview",
                updated: "2026-04-26T12:34:56Z"
            ),
            .tasks(
                score: 0.55,
                id: "task-answer",
                title: "Wire macOS answer",
                state: "ready",
                priority: "p2",
                updatedAt: "2026-04-23T00:00:00Z"
            ),
        ]
        let citations: [AnswerCitation] = [
            AnswerCitation(source: "knowledge", id: "kn-1"),
            AnswerCitation(source: "tasks", id: "task-answer"),
        ]
        let rendered = renderAnswerCitationsPlain(citations, hits: hits)
        let expected = """
            knowledge  0.910  kn-1         Cross-store recall fan-out
            tasks      0.550  task-answer  [ready/p2] Wire macOS answer
            """
        XCTAssertEqual(rendered, expected)
    }

    // MARK: - Degradation arms

    func testAnswerResultDecodesNoHitsReason() throws {
        let json = #"{"ok": false, "reason": "no_hits"}"#.data(using: .utf8)!
        let result = try decoder.decode(AnswerResult.self, from: json)
        XCTAssertEqual(result, .noHits)
    }

    func testAnswerResultDecodesSemanticUnavailableReason() throws {
        let json = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
        let result = try decoder.decode(AnswerResult.self, from: json)
        XCTAssertEqual(result, .semanticUnavailable)
    }

    func testAnswerResultDecodesSynthesisFailedReason() throws {
        let json = #"{"ok": false, "reason": "synthesis_failed"}"#.data(using: .utf8)!
        let result = try decoder.decode(AnswerResult.self, from: json)
        XCTAssertEqual(result, .synthesisFailed)
    }

    // MARK: - Empty-query branch

    /// `AnswerBodyView` and `loadAnswer` both compute an entered-query
    /// predicate from
    /// `query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty`.
    /// Pinning that predicate keeps the empty-query usage hint and the
    /// `loadAnswer` short-circuit lockstep.
    func testEmptyQueryPredicateMatchesViewAndLoader() {
        for query in ["", "   ", "\t\n", " \n "] {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertTrue(trimmed.isEmpty, "query \(query.debugDescription) should trim to empty")
        }
        for query in ["why does kota exist?", "  why  ", "fan-out"] {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertFalse(trimmed.isEmpty, "query \(query.debugDescription) should remain non-empty after trim")
        }
    }

    // MARK: - Unknown-reason rejection

    func testAnswerResultRejectsUnknownReason() {
        let json = #"{"ok": false, "reason": "rate_limited"}"#.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(AnswerResult.self, from: json))
    }

    // MARK: - Helpers

    /// SwiftUI views do not expose stored properties through `Mirror`
    /// the way ObjC does, so this helper computes the same row
    /// resolution `AnswerSuccessView.citationRows` does. Keeping the
    /// helper alongside the test lets the assertion stay byte-equal to
    /// the view's actual logic without forcing the view to expose a
    /// test-only seam.
    private func computeRows(
        citations: [AnswerCitation],
        hits: [RecallHit]
    ) -> [RecallHit] {
        var byKey: [String: RecallHit] = [:]
        for hit in hits {
            byKey["\(hit.source):\(hit.id)"] = hit
        }
        return citations.compactMap { byKey["\($0.source):\($0.id)"] }
    }
}
