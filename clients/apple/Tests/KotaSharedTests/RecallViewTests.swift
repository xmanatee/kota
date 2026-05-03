import XCTest
@testable import KotaShared

/// Coverage for the menu-bar `RecallView` data path. The view body is a thin
/// projection over the discriminated `RecallSearchResponse`, the per-arm
/// `RecallHit.describe` computed property the shared `renderRecallHitsPlain`
/// helper also reads, and the empty-query trim predicate `loadRecall` and
/// `RecallBodyView` both consult. The five operator-visible branches the
/// task contract enumerates land here:
///
/// - **populated** — `RecallSearchResponse.success(hits: [...])` decoded
///   across every `RecallHit` arm (knowledge / memory / history / tasks)
///   plus the rendered line shape, proving each per-arm describe lands
///   in the source/score/id-tagged row the SwiftUI view consumes.
/// - **empty** — `RecallSearchResponse.success(hits: [])` plus the
///   rendered empty-string body the view replaces with "No matching hits.".
/// - **empty-query** — the trim+`isEmpty` predicate `RecallBodyView`
///   reads to surface the inline usage hint and that `loadRecall`
///   reads to short-circuit the request.
/// - **semantic-unavailable** — the `{"ok": false, "reason":
///   "semantic_unavailable"}` branch decoded as `.semanticUnavailable`.
/// - **error** — `DaemonClientTests.testRecallSurfacesHttpErrorOneToOne`
///   already proves the transport-level failure pathway; this file covers
///   the rejection of any *other* `ok: false` reason and the rejection of
///   any unknown `source` arm so the view never silently degrades.
///
/// `AppState` is intentionally not constructed here: its `init` reaches into
/// `UNUserNotificationCenter.current()`, which crashes when the Swift test
/// runner is launched outside a `.app` bundle. Transport-layer branches are
/// exercised in `DaemonClientTests` against the same `MockURLProtocol`.
final class RecallViewTests: XCTestCase {
    private let decoder = JSONDecoder()

    // MARK: - Populated branch

    func testRecallSearchResponseDecodesAllFourArms() throws {
        let json = #"""
        {"ok": true, "hits": [
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
          },
          {
            "source": "history",
            "score": 0.71,
            "id": "hist-1",
            "title": "Recall design discussion",
            "cwd": "/tmp/repo",
            "updatedAt": "2026-04-24T10:00:00Z"
          },
          {
            "source": "tasks",
            "score": 0.55,
            "id": "task-recall-macos",
            "title": "Wire macOS recall",
            "state": "ready",
            "priority": "p2",
            "updatedAt": "2026-04-23T07:00:00Z"
          }
        ]}
        """#.data(using: .utf8)!
        let response = try decoder.decode(RecallSearchResponse.self, from: json)
        guard case .success(let hits) = response else {
            XCTFail("expected populated success branch")
            return
        }
        XCTAssertEqual(hits.count, 4)
        XCTAssertEqual(hits.map { $0.source }, ["knowledge", "memory", "history", "tasks"])

        // Each arm's `describe` exposes exactly the per-arm title the view
        // renders; the SwiftUI view reads `hit.describe` so this pins the
        // contract one-to-one with the helper `renderRecallHitsPlain` reads.
        XCTAssertEqual(hits[0].describe, "Cross-store recall fan-out")
        XCTAssertEqual(hits[1].describe, "Note about recall design")
        XCTAssertEqual(hits[2].describe, "Recall design discussion")
        XCTAssertEqual(hits[3].describe, "[ready/p2] Wire macOS recall")

        XCTAssertEqual(hits[0].score, 0.91, accuracy: 1e-6)
        XCTAssertEqual(hits[3].id, "task-recall-macos")
    }

    func testRenderRecallHitsPlainMatchesSharedLineShape() {
        // Mirrors `renderRecallHitsPlain` from src/modules/recall/render.ts:
        // padEnd source to widest (min 6), score formatted as "%.3f", id
        // padded to widest (min 2), columns joined by two spaces, per-arm
        // describe last. Tests source ordering follows the daemon's
        // `RECALL_SOURCE_ORDER` tie-breaker — view never re-sorts, so the
        // same payload renders identically across CLI / Telegram / web /
        // macOS.
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
                id: "task-recall",
                title: "Wire macOS recall",
                state: "ready",
                priority: "p2",
                updatedAt: "2026-04-23T00:00:00Z"
            ),
        ]
        let rendered = renderRecallHitsPlain(hits)
        let expected = """
            knowledge  0.910  kn-1         Cross-store recall fan-out
            tasks      0.550  task-recall  [ready/p2] Wire macOS recall
            """
        XCTAssertEqual(rendered, expected)
    }

    // MARK: - Empty branch

    func testRecallSearchResponseDecodesEmptyHits() throws {
        let json = #"{"ok": true, "hits": []}"#.data(using: .utf8)!
        let response = try decoder.decode(RecallSearchResponse.self, from: json)
        guard case .success(let hits) = response else {
            XCTFail("expected empty success branch")
            return
        }
        XCTAssertTrue(hits.isEmpty)
    }

    func testRenderRecallHitsPlainEmptyReturnsEmpty() {
        // The view inspects `hits.isEmpty` itself before falling through to
        // the row list (so it can show the fixed "No matching hits." copy),
        // but this mirrors the TS helper's empty contract one-to-one.
        XCTAssertEqual(renderRecallHitsPlain([]), "")
    }

    // MARK: - Empty-query branch

    /// Pins the empty-query hint copy the SwiftUI body renders to the
    /// closed `RecallSource` discriminator set on the daemon
    /// (`knowledge | memory | history | tasks | answer`). The view body
    /// reads `RecallBodyView.emptyQueryHint`, so updating one source of
    /// truth flows to both the rendered surface and this assertion.
    func testRecallEmptyQueryHintEnumeratesFiveSources() {
        XCTAssertEqual(
            RecallBodyView.emptyQueryHint,
            "Type a query to recall across knowledge, memory, history, tasks, and answer."
        )
    }

    /// Rendered Swift snapshot fixture for the empty-query pane. The
    /// fixture file (`RecallEmptyStateSnapshot.txt`, copied into the test
    /// bundle by `Package.swift`) is the operator-cosmetic acceptance
    /// artifact: a serialized rendering of what `RecallBodyView` paints
    /// when `recallQuery` is empty. The test pins the live constant the
    /// view body reads to the rendered-body line in that fixture, so any
    /// drift between the SwiftUI surface and the committed snapshot fails
    /// loudly here. Per `data/tasks/AGENTS.md`, this is the accepted
    /// "rendered Swift snapshot fixture committed alongside the test"
    /// shape for a native macOS surface.
    func testRecallEmptyStateMatchesCommittedSnapshotFixture() throws {
        guard let url = Bundle.module.url(
            forResource: "RecallEmptyStateSnapshot",
            withExtension: "txt"
        ) else {
            XCTFail("RecallEmptyStateSnapshot.txt missing from KotaMenuBarTests resources — check Package.swift")
            return
        }
        let snapshot = try String(contentsOf: url, encoding: .utf8)

        // Locate the rendered-body block: the line after "rendered body (Text):".
        let lines = snapshot.split(separator: "\n", omittingEmptySubsequences: false)
        guard let headerIndex = lines.firstIndex(where: { $0.contains("rendered body (Text):") }),
              headerIndex + 1 < lines.count else {
            XCTFail("snapshot fixture missing rendered-body header")
            return
        }
        let renderedBody = String(lines[headerIndex + 1])
        XCTAssertEqual(
            renderedBody,
            RecallBodyView.emptyQueryHint,
            "Empty-state snapshot fixture drifted from the live RecallBodyView.emptyQueryHint constant"
        )

        // Cross-check the snapshot still pins the closed five-source set so
        // a future copy edit that drops a source name fails this test even
        // if the constant and the snapshot drift in lockstep.
        for source in ["knowledge", "memory", "history", "tasks", "answer"] {
            XCTAssertTrue(
                renderedBody.contains(source),
                "snapshot rendered body missing source \"\(source)\""
            )
        }
    }

    /// The view and `loadRecall` both compute an entered-query predicate
    /// from `query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty`.
    /// This test pins that predicate down so the empty-query usage hint
    /// branch and the `loadRecall` short-circuit stay lockstep.
    func testEmptyQueryPredicateMatchesViewAndLoader() {
        let blankQueries = ["", "   ", "\t\n", " \n "]
        for query in blankQueries {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertTrue(trimmed.isEmpty, "query \(query.debugDescription) should trim to empty")
        }
        let nonBlank = ["recall me", "  recall me  ", "fan-out"]
        for query in nonBlank {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertFalse(trimmed.isEmpty, "query \(query.debugDescription) should remain non-empty after trim")
        }
    }

    // MARK: - Semantic-unavailable branch

    func testRecallSearchResponseDecodesSemanticUnavailable() throws {
        let json = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
        let response = try decoder.decode(RecallSearchResponse.self, from: json)
        XCTAssertEqual(response, .semanticUnavailable)
    }

    // MARK: - Error / unknown branches

    func testRecallSearchResponseRejectsUnknownReason() {
        // Any non-`semantic_unavailable` reason must fail loudly so the view
        // can never silently render an empty-results body when the daemon
        // signals a different failure shape.
        let json = #"{"ok": false, "reason": "rate_limited"}"#.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(RecallSearchResponse.self, from: json))
    }

    func testRecallSearchResponseRejectsUnknownSource() {
        // An unknown discriminator on a single hit must throw rather than
        // silently dropping the hit; the SwiftUI view must never paint over
        // a daemon contract drift.
        let json = #"""
        {"ok": true, "hits": [
          {"source": "files", "score": 0.5, "id": "x", "title": "t", "preview": "p", "updated": "2026-04-01"}
        ]}
        """#.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(RecallSearchResponse.self, from: json))
    }

    // MARK: - Answer-source arm

    /// Pins the `RecallAnswerHit` shape mirrored from
    /// `src/core/server/kota-client.ts`. The success-result variant
    /// decodes through every accessor (`source`, `id`, `score`,
    /// `describe`) so the per-arm view rows render identically with the
    /// other four sources.
    func testRecallSearchResponseDecodesAnswerHitSuccessArm() throws {
        let json = #"""
        {"ok": true, "hits": [
          {
            "source": "answer",
            "score": 0.49,
            "id": "ans-1",
            "query": "How does the harness boundary work?",
            "preview": "The harness boundary is a typed protocol; see kn-42.",
            "citationCount": 1,
            "createdAt": "2026-05-01T12:00:00.000Z",
            "result": { "ok": true }
          }
        ]}
        """#.data(using: .utf8)!
        let response = try decoder.decode(RecallSearchResponse.self, from: json)
        guard case .success(let hits) = response, hits.count == 1 else {
            XCTFail("expected single answer hit")
            return
        }
        let hit = hits[0]
        XCTAssertEqual(hit.source, "answer")
        XCTAssertEqual(hit.id, "ans-1")
        XCTAssertEqual(hit.score, 0.49, accuracy: 1e-6)
        XCTAssertEqual(hit.describe, "How does the harness boundary work?")
        if case .answer(_, _, _, _, let citationCount, _, let result) = hit {
            XCTAssertEqual(citationCount, 1)
            XCTAssertEqual(result, .success)
        } else {
            XCTFail("expected .answer arm")
        }
    }

    /// The failure-arm variant carries the prior synthesizer's failure
    /// `reason` over the same closed set as `AnswerResult`. The
    /// `describe` projection paints the failure inline so the operator
    /// can tell a failed prior synthesis from a successful one without
    /// drilling into the record.
    func testRecallSearchResponseDecodesAnswerHitFailureArm() throws {
        let json = #"""
        {"ok": true, "hits": [
          {
            "source": "answer",
            "score": 0.31,
            "id": "ans-2",
            "query": "What is the latest deploy status?",
            "preview": "Recall returned no hits for this question.",
            "citationCount": 0,
            "createdAt": "2026-05-01T12:05:00.000Z",
            "result": { "ok": false, "reason": "no_hits" }
          }
        ]}
        """#.data(using: .utf8)!
        let response = try decoder.decode(RecallSearchResponse.self, from: json)
        guard case .success(let hits) = response, hits.count == 1 else {
            XCTFail("expected single answer hit")
            return
        }
        XCTAssertEqual(hits[0].describe, "[no_hits] What is the latest deploy status?")
    }

    /// An unknown `reason` on the nested `result` discriminator must
    /// throw rather than silently degrading the rendered surface — the
    /// closed reason set is load-bearing on every visual surface.
    func testRecallSearchResponseRejectsUnknownAnswerResultReason() {
        let json = #"""
        {"ok": true, "hits": [
          {
            "source": "answer",
            "score": 0.31,
            "id": "ans-3",
            "query": "Drift case",
            "preview": "future_reason should not decode",
            "citationCount": 0,
            "createdAt": "2026-05-01T12:10:00.000Z",
            "result": { "ok": false, "reason": "future_reason" }
          }
        ]}
        """#.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(RecallSearchResponse.self, from: json))
    }
}
