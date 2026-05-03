import XCTest
@testable import KotaShared

/// Coverage for the menu-bar `RetractView` data path. The view body is a
/// thin projection over the discriminated four-arm `RetractResult`
/// (success on each of the four record arms, plus the three `ok: false`
/// reason arms `no_contributors` / `not_found` / `contributor_failed`),
/// the empty-identifier predicate `loadRetract` and `RetractBodyView`
/// both consult, the per-target identifier-control narrowing the picker
/// and `RetractRequest` builder share, and the two-submit confirmation
/// gate the dashboard surface already exposes. Every operator-visible
/// branch the task contract enumerates lands here:
///
/// - **success arms** — all four `RetractRecord` arms decode (memory,
///   knowledge, tasks-with-move, inbox-with-path) and survive the
///   `renderRetractResultPlain` pass-through the SwiftUI body uses.
/// - **no_contributors** — the `{"ok": false, "reason":
///   "no_contributors"}` arm decodes and renders the operator-facing
///   notice without throwing (the task explicitly requires the view
///   degrade gracefully on this arm rather than surfacing a thrown
///   error).
/// - **not_found** — the `{"ok": false, "reason": "not_found"}` arm
///   decodes carrying the named target and the verbatim submitted
///   identifier.
/// - **contributor_failed** — the `{"ok": false, "reason":
///   "contributor_failed"}` arm decodes carrying both the target store
///   and the verbatim error message.
/// - **empty-identifier** — the trim+`isEmpty` predicate
///   `RetractBodyView` and `loadRetract` both read.
/// - **unknown reason** — rejection of any other `ok: false` reason so
///   the view never silently degrades on a contract drift.
/// - **per-target identifier control** — `retractIdentifierLabel`,
///   `retractIdentifierPlaceholder`, and `buildRetractRequest` are
///   exhaustive over `RetractTarget` and produce the matching typed
///   `RetractRequest` arm (`id` / `slug` / `path`) without a `default`
///   branch.
/// - **confirmation gate** — `evaluateRetractSubmit` flips through
///   `skip` → `requireConfirmation` → `fire` across the truth table the
///   view exposes (empty identifier collapses to `skip`; first non-empty
///   submit asks for confirmation; second non-empty submit fires).
///
/// `AppState` is intentionally not constructed here — its `init`
/// reaches into `UNUserNotificationCenter.current()`, which crashes
/// outside a `.app` bundle. Transport-layer branches are exercised in
/// `DaemonClientTests` against the same `MockURLProtocol`.
final class RetractViewTests: XCTestCase {
    private let decoder = JSONDecoder()

    // MARK: - Success arms

    func testRetractResultDecodesMemorySuccess() throws {
        let json = #"""
        {"ok": true, "record": {"target": "memory", "recordId": "mem-7"}}
        """#.data(using: .utf8)!
        let result = try decoder.decode(RetractResult.self, from: json)
        guard case let .success(record) = result, case let .memory(id) = record else {
            XCTFail("expected memory success, got \(result)"); return
        }
        XCTAssertEqual(id, "mem-7")
        XCTAssertEqual(renderRetractResultPlain(result), "Retracted: memory  mem-7")
    }

    func testRetractResultDecodesKnowledgeSuccess() throws {
        let json = #"""
        {"ok": true, "record": {"target": "knowledge", "recordId": "kn-rollout-plan"}}
        """#.data(using: .utf8)!
        let result = try decoder.decode(RetractResult.self, from: json)
        guard case let .success(record) = result, case let .knowledge(id) = record else {
            XCTFail("expected knowledge success, got \(result)"); return
        }
        XCTAssertEqual(id, "kn-rollout-plan")
        XCTAssertEqual(
            renderRetractResultPlain(result),
            "Retracted: knowledge  kn-rollout-plan"
        )
    }

    /// The tasks success arm carries a `previousPath -> path` move plus
    /// the `toState` so the operator surface can render "moved to
    /// dropped", not "deleted". Pinning the rendered line shape here
    /// keeps the macOS surface lockstep with the CLI / web / Telegram
    /// surfaces that share `renderRetractResultPlain`.
    func testRetractResultDecodesTasksSuccessWithMove() throws {
        let json = #"""
        {"ok": true, "record": {
          "target": "tasks",
          "recordId": "task-rollout",
          "previousPath": "data/tasks/ready/task-rollout.md",
          "path": "data/tasks/dropped/task-rollout.md",
          "toState": "dropped"
        }}
        """#.data(using: .utf8)!
        let result = try decoder.decode(RetractResult.self, from: json)
        guard case let .success(record) = result,
              case let .tasks(id, previousPath, path, toState) = record
        else {
            XCTFail("expected tasks success, got \(result)"); return
        }
        XCTAssertEqual(id, "task-rollout")
        XCTAssertEqual(previousPath, "data/tasks/ready/task-rollout.md")
        XCTAssertEqual(path, "data/tasks/dropped/task-rollout.md")
        XCTAssertEqual(toState, "dropped")
        XCTAssertEqual(
            renderRetractResultPlain(result),
            "Retracted: tasks  task-rollout  data/tasks/ready/task-rollout.md -> data/tasks/dropped/task-rollout.md (dropped)"
        )
    }

    func testRetractResultDecodesInboxSuccessWithPath() throws {
        let json = #"""
        {"ok": true, "record": {
          "target": "inbox",
          "recordId": "inbox-2026-04-28-buy-milk",
          "path": "data/inbox/2026-04-28-buy-milk.md"
        }}
        """#.data(using: .utf8)!
        let result = try decoder.decode(RetractResult.self, from: json)
        guard case let .success(record) = result, case let .inbox(id, path) = record else {
            XCTFail("expected inbox success, got \(result)"); return
        }
        XCTAssertEqual(id, "inbox-2026-04-28-buy-milk")
        XCTAssertEqual(path, "data/inbox/2026-04-28-buy-milk.md")
        XCTAssertEqual(
            renderRetractResultPlain(result),
            "Retracted: inbox  inbox-2026-04-28-buy-milk  data/inbox/2026-04-28-buy-milk.md"
        )
    }

    // MARK: - Degradation arms

    /// The `no_contributors` arm must decode as a `RetractResult` value
    /// the view can render — never as a thrown error. The task contract
    /// is explicit: `RetractView` surfaces this arm as a user-facing
    /// notice the same way `RetractPanel` and the Telegram
    /// `/retract-<store>` reply degrade.
    func testRetractResultDecodesNoContributorsWithoutThrowing() throws {
        let json = #"{"ok": false, "reason": "no_contributors"}"#.data(using: .utf8)!
        let result = try decoder.decode(RetractResult.self, from: json)
        XCTAssertEqual(result, .noContributors)
        XCTAssertEqual(
            renderRetractResultPlain(result),
            "Cross-store retract has no registered contributors for the named target."
        )
    }

    /// The `not_found` arm must echo the submitted identifier verbatim
    /// so the operator can match it against what they typed; it must not
    /// auto-retry into a different store.
    func testRetractResultDecodesNotFoundWithTargetAndIdentifier() throws {
        let json = #"""
        {"ok": false, "reason": "not_found",
         "target": "memory", "identifier": "mem-missing"}
        """#.data(using: .utf8)!
        let result = try decoder.decode(RetractResult.self, from: json)
        guard case let .notFound(target, identifier) = result else {
            XCTFail("expected notFound arm, got \(result)"); return
        }
        XCTAssertEqual(target, .memory)
        XCTAssertEqual(identifier, "mem-missing")
        XCTAssertEqual(
            renderRetractResultPlain(result),
            #"Retract memory: no record with identifier "mem-missing"."#
        )
    }

    func testRetractResultDecodesContributorFailedWithTargetAndMessage() throws {
        let json = #"""
        {"ok": false, "reason": "contributor_failed",
         "target": "inbox", "message": "inbox writer cannot reach project root"}
        """#.data(using: .utf8)!
        let result = try decoder.decode(RetractResult.self, from: json)
        guard case let .contributorFailed(target, message) = result else {
            XCTFail("expected contributorFailed arm, got \(result)"); return
        }
        XCTAssertEqual(target, .inbox)
        XCTAssertEqual(message, "inbox writer cannot reach project root")
        XCTAssertEqual(
            renderRetractResultPlain(result),
            "Retract from inbox failed: inbox writer cannot reach project root"
        )
    }

    func testRetractResultRejectsUnknownReason() {
        let json = #"{"ok": false, "reason": "rate_limited"}"#.data(using: .utf8)!
        XCTAssertThrowsError(try decoder.decode(RetractResult.self, from: json))
    }

    // MARK: - SwiftUI body's plain-text pass-through

    /// `RetractResultView`'s notice / not-found / contributor-failed
    /// branches forward their text body through `renderRetractResultPlain`
    /// rather than re-implementing the line shape in SwiftUI. Pinning
    /// that pass-through here keeps the menu-bar surface lockstep with
    /// the CLI / web / Telegram surfaces that share the helper.
    func testRenderRetractResultPlainCoversEveryArm() {
        XCTAssertEqual(
            renderRetractResultPlain(.success(record: .memory(recordId: "mem-1"))),
            "Retracted: memory  mem-1"
        )
        XCTAssertEqual(
            renderRetractResultPlain(.success(record: .knowledge(recordId: "kn-1"))),
            "Retracted: knowledge  kn-1"
        )
        XCTAssertEqual(
            renderRetractResultPlain(
                .success(record: .tasks(
                    recordId: "task-x",
                    previousPath: "data/tasks/ready/task-x.md",
                    path: "data/tasks/dropped/task-x.md",
                    toState: "dropped"
                ))
            ),
            "Retracted: tasks  task-x  data/tasks/ready/task-x.md -> data/tasks/dropped/task-x.md (dropped)"
        )
        XCTAssertEqual(
            renderRetractResultPlain(
                .success(record: .inbox(recordId: "inbox-x", path: "data/inbox/x.md"))
            ),
            "Retracted: inbox  inbox-x  data/inbox/x.md"
        )
        XCTAssertEqual(
            renderRetractResultPlain(.noContributors),
            "Cross-store retract has no registered contributors for the named target."
        )
        XCTAssertEqual(
            renderRetractResultPlain(.notFound(target: .knowledge, identifier: "missing-slug")),
            #"Retract knowledge: no record with identifier "missing-slug"."#
        )
        XCTAssertEqual(
            renderRetractResultPlain(.contributorFailed(target: .knowledge, message: "boom")),
            "Retract from knowledge failed: boom"
        )
    }

    // MARK: - Empty-identifier branch

    /// `RetractBodyView` and `loadRetract` both compute an entered-
    /// identifier predicate from
    /// `identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty`.
    /// Pinning the predicate keeps the empty-identifier usage hint and
    /// the `loadRetract` short-circuit lockstep with the submit button's
    /// disabled state.
    func testEmptyIdentifierPredicateMatchesViewAndLoader() {
        for draft in ["", "   ", "\t\n", " \n "] {
            let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertTrue(trimmed.isEmpty, "draft \(draft.debugDescription) should trim to empty")
        }
        for draft in ["mem-7", "  mem-7  ", "data/inbox/note.md"] {
            let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertFalse(trimmed.isEmpty, "draft \(draft.debugDescription) should remain non-empty after trim")
        }
    }

    // MARK: - Picker / identifier-control narrowing

    /// `RetractTarget.allCases` must match the canonical
    /// `RETRACT_TARGET_ORDER` the seam, the CLI, the web `RetractPanel`,
    /// and the agent surfaces share so the picker option order matches
    /// every other operator surface.
    func testRetractTargetAllCasesOrderedAsCanonical() {
        XCTAssertEqual(RetractTarget.allCases, [.memory, .knowledge, .tasks, .inbox])
    }

    /// The identifier label control narrows on the picker value through
    /// an exhaustive switch over `RetractTarget` with no `default`
    /// branch — adding a fifth contributor must surface as a Swift
    /// switch-exhaustiveness error rather than a runtime branch the
    /// view silently drops. Memory / tasks share the `id` label
    /// because `RetractRequest.memory(id:)` and
    /// `RetractRequest.tasks(id:)` share that field shape; knowledge
    /// uses `slug`; inbox uses `path`.
    func testIdentifierLabelExhaustivePerTarget() {
        XCTAssertEqual(retractIdentifierLabel(for: .memory), "id")
        XCTAssertEqual(retractIdentifierLabel(for: .knowledge), "slug")
        XCTAssertEqual(retractIdentifierLabel(for: .tasks), "id")
        XCTAssertEqual(retractIdentifierLabel(for: .inbox), "path")
    }

    func testIdentifierPlaceholderExhaustivePerTarget() {
        XCTAssertEqual(retractIdentifierPlaceholder(for: .memory), "memory id (e.g. mem-7)")
        XCTAssertEqual(retractIdentifierPlaceholder(for: .knowledge), "knowledge slug")
        XCTAssertEqual(
            retractIdentifierPlaceholder(for: .tasks),
            "task id (filename without .md)"
        )
        XCTAssertEqual(
            retractIdentifierPlaceholder(for: .inbox),
            "data/inbox/note-foo.md"
        )
    }

    /// `buildRetractRequest` narrows on the picker value through an
    /// exhaustive switch and produces the typed `RetractRequest` arm
    /// matching the chosen target. Switching the target therefore
    /// requires the view to reset the identifier draft (the type system
    /// rejects passing an inbox `path` alongside a memory `id` at
    /// compile time, but the same draft string would semantically wrong).
    func testBuildRetractRequestPicksMatchingArmPerTarget() {
        XCTAssertEqual(
            buildRetractRequest(target: .memory, identifier: "mem-7"),
            .memory(id: "mem-7")
        )
        XCTAssertEqual(
            buildRetractRequest(target: .knowledge, identifier: "kn-rollout"),
            .knowledge(slug: "kn-rollout")
        )
        XCTAssertEqual(
            buildRetractRequest(target: .tasks, identifier: "task-rollout"),
            .tasks(id: "task-rollout")
        )
        XCTAssertEqual(
            buildRetractRequest(target: .inbox, identifier: "data/inbox/note.md"),
            .inbox(path: "data/inbox/note.md")
        )
    }

    /// The wire encode of `RetractRequest` carries the matching
    /// per-target field — `id` / `slug` / `path`. Pinning the wire
    /// shape here keeps the macOS surface lockstep with the daemon's
    /// `POST /retract` route across every contributor.
    func testBuildRetractRequestEncodesMatchingWireField() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        for (target, identifier, expected) in [
            (RetractTarget.memory, "mem-7", #"{"id":"mem-7","target":"memory"}"#),
            (RetractTarget.knowledge, "kn-rollout", #"{"slug":"kn-rollout","target":"knowledge"}"#),
            (RetractTarget.tasks, "task-rollout", #"{"id":"task-rollout","target":"tasks"}"#),
            (
                RetractTarget.inbox,
                "data/inbox/note.md",
                #"{"path":"data\/inbox\/note.md","target":"inbox"}"#
            ),
        ] {
            let request = buildRetractRequest(target: target, identifier: identifier)
            let data = try encoder.encode(request)
            XCTAssertEqual(String(data: data, encoding: .utf8), expected)
        }
    }

    // MARK: - Confirmation gate

    /// Empty / whitespace identifiers always collapse to `skip`,
    /// regardless of the confirmation flag. The submit button is
    /// disabled in that state, but `loadRetract` is still defensive
    /// against accidental fires (e.g. a Retry button after an error
    /// when the operator has cleared the draft).
    func testEvaluateRetractSubmitSkipsWhenIdentifierEmpty() {
        for confirmed in [false, true] {
            for draft in ["", "   ", "\t\n"] {
                XCTAssertEqual(
                    evaluateRetractSubmit(target: .memory, identifier: draft, confirmed: confirmed),
                    .skip,
                    "draft \(draft.debugDescription) confirmed=\(confirmed) should skip"
                )
            }
        }
    }

    /// First submit on a non-empty draft asks for confirmation —
    /// the view flips its label to "Confirm retract" and surfaces the
    /// destructive notice; the request is not yet fired.
    func testEvaluateRetractSubmitRequiresConfirmationOnFirstSubmit() {
        for target in RetractTarget.allCases {
            XCTAssertEqual(
                evaluateRetractSubmit(target: target, identifier: "value", confirmed: false),
                .requireConfirmation
            )
        }
    }

    /// Second submit on the same draft fires the typed
    /// `RetractRequest`. Whitespace is trimmed before the request is
    /// built so a draft like `"  mem-7  "` fires `.memory(id: "mem-7")`.
    func testEvaluateRetractSubmitFiresOnSecondSubmitWithTrimmedIdentifier() {
        XCTAssertEqual(
            evaluateRetractSubmit(target: .memory, identifier: "  mem-7  ", confirmed: true),
            .fire(.memory(id: "mem-7"))
        )
        XCTAssertEqual(
            evaluateRetractSubmit(target: .knowledge, identifier: "kn-rollout", confirmed: true),
            .fire(.knowledge(slug: "kn-rollout"))
        )
        XCTAssertEqual(
            evaluateRetractSubmit(target: .tasks, identifier: "task-rollout", confirmed: true),
            .fire(.tasks(id: "task-rollout"))
        )
        XCTAssertEqual(
            evaluateRetractSubmit(
                target: .inbox,
                identifier: "data/inbox/note.md",
                confirmed: true
            ),
            .fire(.inbox(path: "data/inbox/note.md"))
        )
    }
}
