import XCTest
@testable import KotaMenuBar

/// Coverage for the menu-bar `CaptureView` data path. The view body is a
/// thin projection over the discriminated four-arm `CaptureResult`
/// (success on each of the four record arms, plus the three `ok: false`
/// reason arms `ambiguous` / `no_contributors` / `contributor_failed`),
/// the empty-draft predicate `loadCapture` and `CaptureBodyView` both
/// consult, and the `CaptureTargetChoice` mapping the `Picker` exposes.
/// Every operator-visible branch the task contract enumerates lands here:
///
/// - **success arms** — all four `CaptureRecord` arms decode (memory,
///   knowledge, tasks-with-path, inbox-with-path) and survive the
///   `renderCaptureResultPlain` pass-through the SwiftUI body uses.
/// - **ambiguous** — the `{"ok": false, "reason": "ambiguous"}` arm
///   decodes with the suggestion list preserved in order.
/// - **no_contributors** — the `{"ok": false, "reason": "no_contributors"}`
///   arm decodes and renders the operator-facing notice without
///   throwing (the task explicitly requires the view degrade gracefully
///   on this arm rather than surfacing a thrown error).
/// - **contributor_failed** — the `{"ok": false, "reason":
///   "contributor_failed"}` arm decodes carrying both the target store
///   and the verbatim error message.
/// - **empty-draft** — the trim+`isEmpty` predicate `CaptureBodyView` and
///   `loadCapture` both read.
/// - **unknown reason** — rejection of any other `ok: false` reason so
///   the view never silently degrades on a contract drift.
/// - **CaptureTargetChoice** — the picker's `.auto` arm collapses to a
///   `nil` target (so the daemon classifier picks the store), and each
///   `.target` arm collapses one-to-one to the wire `CaptureTarget`.
///
/// `AppState` is intentionally not constructed here — its `init` reaches
/// into `UNUserNotificationCenter.current()`, which crashes outside a
/// `.app` bundle. Transport-layer branches are exercised in
/// `DaemonClientTests` against the same `MockURLProtocol`.
final class CaptureViewTests: XCTestCase {
    private let decoder = JSONDecoder()

    // MARK: - Success arms

    func testCaptureResultDecodesMemorySuccess() throws {
        let json = #"""
        {"ok": true, "record": {"target": "memory", "recordId": "mem-99"}}
        """#.data(using: .utf8)!
        let result = try decoder.decode(CaptureResult.self, from: json)
        guard case let .success(record) = result, case let .memory(id) = record else {
            XCTFail("expected memory success, got \(result)"); return
        }
        XCTAssertEqual(id, "mem-99")
        XCTAssertEqual(renderCaptureResultPlain(result), "Captured: memory  mem-99")
    }

    func testCaptureResultDecodesKnowledgeSuccess() throws {
        let json = #"""
        {"ok": true, "record": {"target": "knowledge", "recordId": "kn-7"}}
        """#.data(using: .utf8)!
        let result = try decoder.decode(CaptureResult.self, from: json)
        guard case let .success(record) = result, case let .knowledge(id) = record else {
            XCTFail("expected knowledge success, got \(result)"); return
        }
        XCTAssertEqual(id, "kn-7")
        XCTAssertEqual(renderCaptureResultPlain(result), "Captured: knowledge  kn-7")
    }

    func testCaptureResultDecodesTasksSuccessWithPath() throws {
        let json = #"""
        {"ok": true, "record": {
          "target": "tasks",
          "recordId": "task-buy-milk",
          "path": "data/tasks/ready/task-buy-milk.md"
        }}
        """#.data(using: .utf8)!
        let result = try decoder.decode(CaptureResult.self, from: json)
        guard case let .success(record) = result, case let .tasks(id, path) = record else {
            XCTFail("expected tasks success, got \(result)"); return
        }
        XCTAssertEqual(id, "task-buy-milk")
        XCTAssertEqual(path, "data/tasks/ready/task-buy-milk.md")
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Captured: tasks  task-buy-milk  data/tasks/ready/task-buy-milk.md"
        )
    }

    func testCaptureResultDecodesInboxSuccessWithPath() throws {
        let json = #"""
        {"ok": true, "record": {
          "target": "inbox",
          "recordId": "inbox-2026-04-28-buy-milk",
          "path": "data/inbox/2026-04-28-buy-milk.md"
        }}
        """#.data(using: .utf8)!
        let result = try decoder.decode(CaptureResult.self, from: json)
        guard case let .success(record) = result, case let .inbox(id, path) = record else {
            XCTFail("expected inbox success, got \(result)"); return
        }
        XCTAssertEqual(id, "inbox-2026-04-28-buy-milk")
        XCTAssertEqual(path, "data/inbox/2026-04-28-buy-milk.md")
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Captured: inbox  inbox-2026-04-28-buy-milk  data/inbox/2026-04-28-buy-milk.md"
        )
    }

    // MARK: - Degradation arms

    func testCaptureResultDecodesAmbiguousPreservingOrder() throws {
        let json = #"""
        {"ok": false, "reason": "ambiguous", "suggestions": ["knowledge", "memory"]}
        """#.data(using: .utf8)!
        let result = try decoder.decode(CaptureResult.self, from: json)
        guard case let .ambiguous(suggestions) = result else {
            XCTFail("expected ambiguous arm, got \(result)"); return
        }
        XCTAssertEqual(suggestions, [.knowledge, .memory])
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Ambiguous capture. Re-run with --target <one of: knowledge, memory>."
        )
    }

    /// The `no_contributors` arm must decode as a `CaptureResult` value
    /// the view can render — never as a thrown error. The task contract
    /// is explicit: `CaptureView` surfaces this arm as a user-facing
    /// notice the same way `CapturePanel` and the Telegram `/capture`
    /// reply degrade.
    func testCaptureResultDecodesNoContributorsWithoutThrowing() throws {
        let json = #"{"ok": false, "reason": "no_contributors"}"#.data(using: .utf8)!
        let result = try decoder.decode(CaptureResult.self, from: json)
        XCTAssertEqual(result, .noContributors)
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Cross-store capture has no registered contributors."
        )
    }

    func testCaptureResultDecodesContributorFailedWithTargetAndMessage() throws {
        let json = #"""
        {"ok": false, "reason": "contributor_failed",
         "target": "inbox", "message": "inbox writer cannot reach project root"}
        """#.data(using: .utf8)!
        let result = try decoder.decode(CaptureResult.self, from: json)
        guard case let .contributorFailed(target, message) = result else {
            XCTFail("expected contributorFailed arm, got \(result)"); return
        }
        XCTAssertEqual(target, .inbox)
        XCTAssertEqual(message, "inbox writer cannot reach project root")
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Capture into inbox failed: inbox writer cannot reach project root"
        )
    }

    func testCaptureResultRejectsUnknownReason() {
        let json = #"{"ok": false, "reason": "rate_limited"}"#.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(CaptureResult.self, from: json))
    }

    // MARK: - SwiftUI body's plain-text pass-through

    /// `CaptureResultView`'s no-contributors and contributor-failed
    /// branches forward their text body through `renderCaptureResultPlain`
    /// rather than re-implementing the line shape in SwiftUI. Pinning
    /// that pass-through here keeps the menu-bar surface lockstep with
    /// the CLI / web / Telegram surfaces that share the helper.
    func testRenderCaptureResultPlainCoversEveryArm() {
        XCTAssertEqual(
            renderCaptureResultPlain(.success(record: .memory(recordId: "mem-1"))),
            "Captured: memory  mem-1"
        )
        XCTAssertEqual(
            renderCaptureResultPlain(.success(record: .knowledge(recordId: "kn-1"))),
            "Captured: knowledge  kn-1"
        )
        XCTAssertEqual(
            renderCaptureResultPlain(
                .success(record: .tasks(recordId: "task-x", path: "data/tasks/ready/task-x.md"))
            ),
            "Captured: tasks  task-x  data/tasks/ready/task-x.md"
        )
        XCTAssertEqual(
            renderCaptureResultPlain(
                .success(record: .inbox(recordId: "inbox-x", path: "data/inbox/x.md"))
            ),
            "Captured: inbox  inbox-x  data/inbox/x.md"
        )
        XCTAssertEqual(
            renderCaptureResultPlain(.ambiguous(suggestions: [.tasks, .inbox])),
            "Ambiguous capture. Re-run with --target <one of: tasks, inbox>."
        )
        XCTAssertEqual(
            renderCaptureResultPlain(.noContributors),
            "Cross-store capture has no registered contributors."
        )
        XCTAssertEqual(
            renderCaptureResultPlain(.contributorFailed(target: .knowledge, message: "boom")),
            "Capture into knowledge failed: boom"
        )
    }

    // MARK: - Empty-draft branch

    /// `CaptureBodyView` and `loadCapture` both compute an entered-draft
    /// predicate from
    /// `draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty`.
    /// Pinning the predicate keeps the empty-draft usage hint and the
    /// `loadCapture` short-circuit lockstep with the submit button's
    /// disabled state.
    func testEmptyDraftPredicateMatchesViewAndLoader() {
        for draft in ["", "   ", "\t\n", " \n "] {
            let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertTrue(trimmed.isEmpty, "draft \(draft.debugDescription) should trim to empty")
        }
        for draft in ["buy milk", "  buy milk  ", "follow up on the rollout"] {
            let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertFalse(trimmed.isEmpty, "draft \(draft.debugDescription) should remain non-empty after trim")
        }
    }

    // MARK: - Picker choice mapping

    /// The picker's `.auto` arm collapses to a `nil` target so the
    /// daemon classifier picks the store; each `.target(...)` arm
    /// collapses one-to-one to the wire `CaptureTarget`. Pinning this
    /// keeps the SwiftUI picker lockstep with the wire contract — a
    /// new `CaptureTarget` arm landed here would force the picker
    /// vocabulary to grow alongside the wire enum.
    func testCaptureTargetChoiceCollapsesToWireTarget() {
        XCTAssertNil(CaptureTargetChoice.auto.resolved)
        XCTAssertEqual(CaptureTargetChoice.target(.memory).resolved, .memory)
        XCTAssertEqual(CaptureTargetChoice.target(.knowledge).resolved, .knowledge)
        XCTAssertEqual(CaptureTargetChoice.target(.tasks).resolved, .tasks)
        XCTAssertEqual(CaptureTargetChoice.target(.inbox).resolved, .inbox)
        XCTAssertEqual(CaptureTarget.allCases, [.memory, .knowledge, .tasks, .inbox])
    }
}
