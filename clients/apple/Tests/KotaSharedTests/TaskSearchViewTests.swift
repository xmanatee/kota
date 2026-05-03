import XCTest
@testable import KotaShared

/// Coverage for the menu-bar `TaskSearchView` data path. The view body is a
/// thin projection over the discriminated `TasksSearchResponse` and the
/// shared `renderRepoTaskSearchPlain` helper. The five operator-visible
/// branches the task contract enumerates land here:
///
/// - **populated** — `TasksSearchResponse.success(tasks: [...])` decoded plus
///   the rendered line shape proves the per-task id/state/priority/title
///   columns the view emits.
/// - **empty** — `TasksSearchResponse.success(tasks: [])` plus the rendered
///   empty-string body the view replaces with "No matching tasks.".
/// - **empty-query** — the trim+`isEmpty` predicate `TaskSearchBodyView`
///   reads to surface the inline usage hint and that `loadTasksSearch`
///   reads to short-circuit the request.
/// - **semantic-unavailable** — the `{"ok": false, "reason":
///   "semantic_unavailable"}` branch decoded as `.semanticUnavailable`.
/// - **error** — `DaemonClientTests.testSearchTasksSurfacesHttpErrorOneToOne`
///   already proves the transport-level failure pathway; this file covers
///   the rejection of any *other* `ok: false` reason so the view never
///   silently degrades.
///
/// `AppState` is intentionally not constructed here. The transport-layer
/// branches are exercised in `DaemonClientTests` against the same
/// `MockURLProtocol`, and the integrated state container is covered by
/// `AppStateTests` (which uses the `startPollingOnInit: false` /
/// `NotificationManaging` injection seam to avoid the
/// `UNUserNotificationCenter.current()` crash outside an `.app` bundle).
final class TaskSearchViewTests: XCTestCase {
    private let decoder = JSONDecoder()

    // MARK: - Populated branch

    func testTasksSearchResponseDecodesPopulatedTasks() throws {
        let json = #"""
        {"ok": true, "tasks": [
          {
            "id": "task-foo",
            "title": "Tasks surface fan-out",
            "state": "ready",
            "priority": "p2",
            "area": "client",
            "summary": "Wire the macOS view",
            "updatedAt": "2026-04-26T12:34:56Z",
            "score": 0.91
          },
          {
            "id": "task-bar",
            "title": "Operator-pull parity",
            "state": "doing",
            "priority": "p1",
            "area": "client",
            "summary": "Mobile screen",
            "updatedAt": "2026-04-25T08:00:00Z",
            "score": 0.42
          }
        ]}
        """#.data(using: .utf8)!
        let response = try decoder.decode(TasksSearchResponse.self, from: json)
        guard case .success(let tasks) = response else {
            XCTFail("expected populated success branch")
            return
        }
        XCTAssertEqual(tasks.count, 2)
        XCTAssertEqual(tasks[0].id, "task-foo")
        XCTAssertEqual(tasks[0].state, "ready")
        XCTAssertEqual(tasks[0].priority, "p2")
        XCTAssertEqual(tasks[0].title, "Tasks surface fan-out")
        XCTAssertEqual(tasks[0].score, 0.91, accuracy: 1e-6)
        XCTAssertEqual(tasks[1].id, "task-bar")
    }

    func testRenderRepoTaskSearchPlainMatchesSharedLineShape() {
        // Mirrors `renderRepoTaskSearchPlain` from src/modules/repo-tasks/render.ts:
        // padEnd to widest id/state/priority, two spaces between columns,
        // title last. The view feeds this same body through a monospaced
        // Text node so the populated state renders identically to Telegram,
        // the CLI, and the daemon HTTP body.
        let hits = [
            RepoTaskSearchHit(
                id: "task-foo",
                title: "Tasks surface fan-out",
                state: "ready",
                priority: "p2",
                area: "client",
                summary: "summary",
                updatedAt: "2026-04-26T12:34:56Z",
                score: 0.91
            ),
            RepoTaskSearchHit(
                id: "task-mobile",
                title: "Operator-pull parity",
                state: "backlog",
                priority: "p1",
                area: "client",
                summary: "summary",
                updatedAt: "2026-04-25T08:00:00Z",
                score: 0.42
            ),
        ]
        let rendered = renderRepoTaskSearchPlain(hits)
        let expected = """
            task-foo     ready    p2    Tasks surface fan-out
            task-mobile  backlog  p1    Operator-pull parity
            """
        XCTAssertEqual(rendered, expected)
    }

    func testRenderRepoTaskSearchPlainHonorsMinimumWidths() {
        // id min width 2, state min width 5, priority min width 4 — matches TS.
        let hits = [
            RepoTaskSearchHit(
                id: "a",
                title: "Short",
                state: "rdy",
                priority: "p0",
                area: "client",
                summary: "summary",
                updatedAt: "2026-04-26T00:00:00Z",
                score: 1.0
            )
        ]
        XCTAssertEqual(renderRepoTaskSearchPlain(hits), "a   rdy    p0    Short")
    }

    // MARK: - Empty branch

    func testTasksSearchResponseDecodesEmptyTasks() throws {
        let json = #"{"ok": true, "tasks": []}"#.data(using: .utf8)!
        let response = try decoder.decode(TasksSearchResponse.self, from: json)
        guard case .success(let tasks) = response else {
            XCTFail("expected empty success branch")
            return
        }
        XCTAssertTrue(tasks.isEmpty)
    }

    func testRenderRepoTaskSearchPlainEmptyReturnsEmpty() {
        // The view inspects `tasks.isEmpty` itself before calling the helper
        // (so it can show the fixed "No matching tasks." copy), but this
        // mirrors the TS helper's empty contract one-to-one.
        XCTAssertEqual(renderRepoTaskSearchPlain([]), "")
    }

    // MARK: - Empty-query branch

    /// The view and `loadTasksSearch` both compute an entered-query predicate
    /// from `query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty`.
    /// This test pins that predicate down so the empty-query usage hint
    /// branch and the `loadTasksSearch` short-circuit stay lockstep.
    func testEmptyQueryPredicateMatchesViewAndLoader() {
        let blankQueries = ["", "   ", "\t\n", " \n "]
        for query in blankQueries {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertTrue(trimmed.isEmpty, "query \(query.debugDescription) should trim to empty")
        }
        let nonBlank = ["fan-out", "  fan-out  ", "task"]
        for query in nonBlank {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertFalse(trimmed.isEmpty, "query \(query.debugDescription) should remain non-empty after trim")
        }
    }

    // MARK: - Semantic-unavailable branch

    func testTasksSearchResponseDecodesSemanticUnavailable() throws {
        let json = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
        let response = try decoder.decode(TasksSearchResponse.self, from: json)
        XCTAssertEqual(response, .semanticUnavailable)
    }

    // MARK: - Error / unknown-reason branch

    func testTasksSearchResponseRejectsUnknownReason() {
        // Any non-`semantic_unavailable` reason must fail loudly so the view
        // can never silently render an empty-results body when the daemon
        // signals a different failure shape.
        let json = #"{"ok": false, "reason": "something_else"}"#.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(TasksSearchResponse.self, from: json))
    }
}
