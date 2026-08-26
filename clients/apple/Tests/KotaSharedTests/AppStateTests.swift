import XCTest
@testable import KotaShared

/// Integrated coverage for the menu-bar `AppState` container itself,
/// not just the pure helpers that hang off it. Three flows are pinned:
///
///   - capability-driven dashboard gating (`isDashboardAvailable`,
///     `webUIURL`) — `MenuBarView` hides the "Open Dashboard" action
///     based on these and they were previously only covered by the
///     contract decoder, never against the live state container.
///   - offline reset — `refresh()` with no `scopeRoot` and no
///     `remoteURL` must wipe every cached on-demand body so a stale
///     digest/answer/capture never paints over the disconnected state.
///   - notification fan-out — the second pass through
///     `checkForNotifications` must emit one notification per *new*
///     failed run, pending approval, and pending owner question, and
///     must not re-emit on a subsequent pass with the same ids.
///
/// Each test constructs `AppState` through the production initializer
/// using a recording `NotificationManaging` stub and
/// `startPollingOnInit: false`. That seam was added so the state model
/// could be exercised in `swift test`, which runs outside an `.app`
/// bundle and would otherwise crash on
/// `UNUserNotificationCenter.current()`. The stub also lets the
/// notification-fan-out test assert call shape without any real
/// notification side effect.
@MainActor
final class AppStateTests: XCTestCase {

    /// Recording stub for the `NotificationManaging` seam injected into
    /// `AppState`. Captures every `notify(...)` call in submission order
    /// and counts authorization requests so tests can assert that
    /// `startPollingOnInit: false` truly suppresses the boot-time
    /// authorization side effect.
    final class RecordingNotifications: NotificationManaging {
        struct Notification: Equatable {
            let title: String
            let body: String
            let identifier: String
        }

        private(set) var authorizationCount = 0
        private(set) var notifications: [Notification] = []

        func requestAuthorization() {
            authorizationCount += 1
        }

        func notify(title: String, body: String, identifier: String) {
            notifications.append(Notification(title: title, body: body, identifier: identifier))
        }
    }

    private func makeState(notifications: NotificationManaging) -> AppState {
        clearMenuBarUserDefaults()
        return AppState(
            client: nil,
            notifications: notifications,
            startPollingOnInit: false
        )
    }

    private func clearMenuBarUserDefaults() {
        // The production `init` reads `scopeDirectory` and
        // `remoteDaemonURL` from the shared `UserDefaults`. A previous
        // test run could have planted stale values in the test-process
        // suite, so wipe them before each construction.
        UserDefaults.standard.removeObject(forKey: "scopeDirectory")
        UserDefaults.standard.removeObject(forKey: "remoteDaemonURL")
        UserDefaults.standard.removeObject(forKey: "notificationsEnabled")
    }

    // MARK: - Construction and side-effect suppression

    func testInitWithStartPollingOnInitFalseDoesNotRequestAuthorization() {
        let stub = RecordingNotifications()
        _ = makeState(notifications: stub)
        XCTAssertEqual(
            stub.authorizationCount, 0,
            "Suppressed init must not call requestAuthorization — that path crashes outside an .app bundle."
        )
    }

    // MARK: - Dashboard capability gating

    func testIsDashboardAvailableTracksIdentityDashboardArm() {
        let state = makeState(notifications: RecordingNotifications())
        XCTAssertFalse(
            state.isDashboardAvailable,
            "With no identity payload yet, the menu bar must hide the Open Dashboard action."
        )

        state.connection.identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/Users/op/Desktop/mono/apps/kota",
            scopeRegistry: makeScopeRegistry(
                defaultScopeId: "p-test",
                directoryScopes: [
                    directoryScope(scopeId: "p-test", displayName: "kota", directoryRoot: "/Users/op/Desktop/mono/apps/kota")
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        XCTAssertTrue(
            state.isDashboardAvailable,
            "Once identity reports dashboard.available, the menu bar must show the action."
        )

        state.connection.identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/Users/op/Desktop/mono/apps/kota",
            scopeRegistry: makeScopeRegistry(
                defaultScopeId: "p-test",
                directoryScopes: [
                    directoryScope(scopeId: "p-test", displayName: "kota", directoryRoot: "/Users/op/Desktop/mono/apps/kota")
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .unavailable(reason: "disabled", message: nil)
        )
        XCTAssertFalse(
            state.isDashboardAvailable,
            "When the daemon stops advertising the dashboard, the menu bar must hide the action again."
        )
    }

    // MARK: - Offline reset clears every cached on-demand body

    func testRefreshWithNoScopeClearsEveryCachedBody() async {
        let state = makeState(notifications: RecordingNotifications())

        // Seed every cached on-demand body. If a future on-demand surface
        // lands without a paired entry in `clearOnDemandForOffline`, this
        // test will catch the regression — the offline branch must wipe
        // the lot so a stale rollup never paints over the disconnected
        // state.
        state.activity.activeRuns = [
            ActiveRun(
                runId: "run-1",
                workflow: "builder",
                startedAt: "2026-04-29T00:00:00Z"
            )
        ]
        state.activity.recentRuns = [
            RunSummary(
                id: "run-old",
                workflow: "builder",
                status: "success",
                startedAt: "2026-04-28T00:00:00Z",
                durationMs: 1000
            )
        ]
        state.connection.identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/x",
            scopeRegistry: makeScopeRegistry(
                defaultScopeId: "p-test",
                directoryScopes: [
                    directoryScope(scopeId: "p-test", displayName: "kota", directoryRoot: "/Users/op/Desktop/mono/apps/kota")
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        state.connection.health = .running(1)
        state.content.knowledgeError = "stale"
        state.content.memoryError = "stale"
        state.content.historyError = "stale"
        state.content.tasksError = "stale"
        state.content.recallError = "stale"
        state.content.answerError = "stale"
        state.content.captureError = "stale"
        state.content.retractError = "stale"
        state.content.digestError = "stale"
        state.content.attentionError = "stale"
        state.content.isLoadingDigest = true
        state.content.isLoadingAttention = true
        state.content.isLoadingKnowledge = true
        state.content.isLoadingMemory = true
        state.content.isLoadingHistory = true
        state.content.isLoadingTasksSearch = true
        state.content.isLoadingRecall = true
        state.content.isLoadingAnswer = true
        state.content.isLoadingCapture = true
        state.content.isLoadingRetract = true
        state.content.retractConfirmed = true
        state.content.answerLogEntries = [
            AnswerHistoryEntry(
                id: "ans-stale",
                createdAt: "2026-04-29T00:00:00Z",
                query: "stale",
                result: .failure(reason: .noHits)
            )
        ]
        state.content.answerLogError = "stale"
        state.content.isLoadingAnswerLog = true
        state.content.answerLogHasMore = true
        state.content.answerShowOpenId = "ans-stale"
        state.content.answerShowMissing = true
        state.content.answerShowError = "stale"
        state.content.isLoadingAnswerShow = true
        state.scopeRoot = nil
        state.remoteURL = ""

        await state.refresh()

        if case .offline = state.connection.health {
            // expected
        } else {
            XCTFail("offline branch must set health to .offline")
        }
        XCTAssertEqual(state.connection.diagnostic, .noScope)
        XCTAssertTrue(state.activity.activeRuns.isEmpty)
        XCTAssertTrue(state.activity.recentRuns.isEmpty)
        XCTAssertNil(state.connection.identity)
        XCTAssertNil(state.connection.capabilities)
        XCTAssertTrue(state.activity.workflowDefinitions.isEmpty)
        XCTAssertNil(state.content.digest)
        XCTAssertNil(state.content.digestError)
        XCTAssertFalse(state.content.isLoadingDigest)
        XCTAssertNil(state.content.attention)
        XCTAssertNil(state.content.attentionError)
        XCTAssertFalse(state.content.isLoadingAttention)
        XCTAssertNil(state.content.knowledgeResult)
        XCTAssertNil(state.content.knowledgeError)
        XCTAssertFalse(state.content.isLoadingKnowledge)
        XCTAssertNil(state.content.memoryResult)
        XCTAssertNil(state.content.memoryError)
        XCTAssertFalse(state.content.isLoadingMemory)
        XCTAssertNil(state.content.historyResult)
        XCTAssertNil(state.content.historyError)
        XCTAssertFalse(state.content.isLoadingHistory)
        XCTAssertNil(state.content.tasksResult)
        XCTAssertNil(state.content.tasksError)
        XCTAssertFalse(state.content.isLoadingTasksSearch)
        XCTAssertNil(state.content.recallResult)
        XCTAssertNil(state.content.recallError)
        XCTAssertFalse(state.content.isLoadingRecall)
        XCTAssertNil(state.content.answerResult)
        XCTAssertNil(state.content.answerError)
        XCTAssertFalse(state.content.isLoadingAnswer)
        XCTAssertNil(state.content.captureResult)
        XCTAssertNil(state.content.captureError)
        XCTAssertFalse(state.content.isLoadingCapture)
        XCTAssertNil(state.content.retractResult)
        XCTAssertNil(state.content.retractError)
        XCTAssertFalse(state.content.isLoadingRetract)
        XCTAssertFalse(state.content.retractConfirmed)
        XCTAssertTrue(state.content.answerLogEntries.isEmpty)
        XCTAssertNil(state.content.answerLogError)
        XCTAssertFalse(state.content.isLoadingAnswerLog)
        XCTAssertFalse(state.content.answerLogHasMore)
        XCTAssertNil(state.content.answerShowOpenId)
        XCTAssertNil(state.content.answerShowRecord)
        XCTAssertFalse(state.content.answerShowMissing)
        XCTAssertNil(state.content.answerShowError)
        XCTAssertFalse(state.content.isLoadingAnswerShow)
    }

    // MARK: - Active scope selection

    func testReconcileActiveScopeIdSeedsDefaultThenPreservesValidSelection() {
        let state = makeState(notifications: RecordingNotifications())
        let projection = makeScopeRegistry(
            defaultScopeId: "p-default",
            directoryScopes: [
                directoryScope(scopeId: "p-default", displayName: "kota", directoryRoot: "/tmp/kota"),
                directoryScope(scopeId: "p-other", displayName: "other", directoryRoot: "/tmp/other"),
            ]
        )
        XCTAssertNil(state.connection.activeScopeId)
        state.reconcileActiveScopeId(with: projection)
        XCTAssertEqual(state.connection.activeScopeId, "p-default")

        // A subsequent reconcile with the same registry preserves the
        // current selection — the operator has not changed scopes.
        state.reconcileActiveScopeId(with: projection)
        XCTAssertEqual(state.connection.activeScopeId, "p-default")
    }

    func testReconcileActiveScopeIdResetsWhenSelectionDropsOutOfRegistry() {
        let state = makeState(notifications: RecordingNotifications())
        state.connection.identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/tmp/kota",
            scopeRegistry: makeScopeRegistry(
                defaultScopeId: "p-default",
                directoryScopes: [
                    directoryScope(scopeId: "p-default", displayName: "kota", directoryRoot: "/tmp/kota"),
                    directoryScope(scopeId: "p-other", displayName: "other", directoryRoot: "/tmp/other"),
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "t",
            dashboard: .available(path: "/")
        )
        state.setActiveScopeId("p-other")
        XCTAssertEqual(state.connection.activeScopeId, "p-other")

        // After a config reload the registry no longer carries `p-other`.
        // The selection must collapse back to the registry's default
        // rather than render daemon rows belonging to a now-unknown id.
        let shrunken = makeScopeRegistry(
            defaultScopeId: "p-default",
            directoryScopes: [
                directoryScope(scopeId: "p-default", displayName: "kota", directoryRoot: "/tmp/kota"),
            ]
        )
        state.reconcileActiveScopeId(with: shrunken)
        XCTAssertEqual(state.connection.activeScopeId, "p-default")
    }

    func testSetActiveScopeIdClearsScopeScopedStateImmediately() {
        let state = makeState(notifications: RecordingNotifications())
        state.connection.identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/tmp/kota",
            scopeRegistry: makeScopeRegistry(
                defaultScopeId: "p-default",
                directoryScopes: [
                    directoryScope(scopeId: "p-default", displayName: "kota", directoryRoot: "/tmp/kota"),
                    directoryScope(scopeId: "p-other", displayName: "other", directoryRoot: "/tmp/other"),
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "t",
            dashboard: .available(path: "/")
        )
        state.reconcileActiveScopeId(with: state.connection.identity!.scopeRegistry)
        XCTAssertEqual(state.connection.activeScopeId, "p-default")
        state.activity.activeRuns = [ActiveRun(runId: "r1", workflow: "builder", startedAt: "t")]
        state.activity.recentRuns = [RunSummary(id: "r0", workflow: "builder", status: "success", startedAt: "t", durationMs: 1)]
        state.activity.pendingApprovals = [
            ApprovalRequest(
                id: "approval-global",
                tool: "shell",
                risk: "elevated",
                reason: "operator decision",
                createdAt: "t",
                status: "pending"
            )
        ]
        state.content.knowledgeQuery = "keep my draft"
        state.content.knowledgeError = "old scope"

        state.setActiveScopeId("p-other")
        XCTAssertEqual(state.connection.activeScopeId, "p-other")
        XCTAssertTrue(state.activity.activeRuns.isEmpty)
        XCTAssertTrue(state.activity.recentRuns.isEmpty)
        XCTAssertEqual(state.activity.pendingApprovals.map(\.id), ["approval-global"])
        XCTAssertEqual(state.content.knowledgeQuery, "keep my draft")
        XCTAssertNil(state.content.knowledgeError)
    }

    // MARK: - Scope-scoped URL builder

    func testWithScopeAppendsQueryParam() {
        XCTAssertEqual(DaemonClient.withScope("/status", scopeId: "p-1"), "/status?scopeId=p-1")
        XCTAssertEqual(
            DaemonClient.withScope("/workflow/runs?limit=10", scopeId: "p-1"),
            "/workflow/runs?limit=10&scopeId=p-1"
        )
        XCTAssertEqual(DaemonClient.withScope("/status", scopeId: nil), "/status")
        XCTAssertEqual(DaemonClient.withScope("/status", scopeId: ""), "/status")
        XCTAssertEqual(
            DaemonClient.withScope("/sessions", scopeId: "p with spaces"),
            "/sessions?scopeId=p%20with%20spaces"
        )
    }

    // MARK: - Notification fan-out across attention surfaces

    func testCheckForNotificationsEmitsOnlyForNewlySeenAttention() {
        let stub = RecordingNotifications()
        let state = makeState(notifications: stub)
        state.notificationsEnabled = true
        state.isPopoverOpen = false

        // First pass seeds the known-id sets without emitting anything,
        // mirroring the production "don't fire stale notifications when
        // re-enabled" behavior.
        state.activity.recentRuns = [
            RunSummary(id: "run-old", workflow: "builder", status: "failed", startedAt: "t0", durationMs: nil)
        ]
        state.activity.pendingApprovals = [
            ApprovalRequest(
                id: "approval-old",
                tool: "shell",
                risk: "elevated",
                reason: "rm -rf /tmp/x",
                createdAt: "t0",
                status: "pending"
            )
        ]
        state.activity.pendingOwnerQuestions = [
            OwnerQuestion(
                id: "owner-old",
                context: "ctx",
                question: "Is this OK?",
                reason: "policy",
                source: "explorer",
                createdAt: "t0",
                status: "pending",
                proposedAnswers: nil
            )
        ]
        invokeCheckForNotifications(on: state)
        XCTAssertEqual(
            stub.notifications.count, 0,
            "First pass must seed the known-id sets without emitting any notification."
        )

        // Second pass: one new failed run, one new approval, one new
        // owner question. Each must emit exactly once with the expected
        // identifier prefix.
        state.activity.recentRuns.append(
            RunSummary(id: "run-new", workflow: "decomposer", status: "failed", startedAt: "t1", durationMs: nil)
        )
        state.activity.pendingApprovals.append(
            ApprovalRequest(
                id: "approval-new",
                tool: "git",
                risk: "elevated",
                reason: "push to remote",
                createdAt: "t1",
                status: "pending"
            )
        )
        state.activity.pendingOwnerQuestions.append(
            OwnerQuestion(
                id: "owner-new",
                context: "ctx2",
                question: "Reject the patch?",
                reason: "explorer",
                source: "explorer",
                createdAt: "t1",
                status: "pending",
                proposedAnswers: nil
            )
        )
        invokeCheckForNotifications(on: state)

        XCTAssertEqual(stub.notifications.count, 3)
        XCTAssertEqual(
            stub.notifications.map { $0.identifier },
            [
                "workflow-failure-run-new",
                "approval-approval-new",
                "owner-question-owner-new",
            ]
        )
        XCTAssertEqual(stub.notifications[0].title, "Workflow failed")
        XCTAssertEqual(stub.notifications[0].body, "decomposer")
        XCTAssertEqual(stub.notifications[1].title, "Approval needed")
        XCTAssertEqual(stub.notifications[1].body, "git: push to remote")
        XCTAssertEqual(stub.notifications[2].title, "Owner question")
        XCTAssertEqual(stub.notifications[2].body, "explorer: Reject the patch?")

        // Third pass with no further changes: must not re-emit.
        state.checkForNotifications()
        XCTAssertEqual(
            stub.notifications.count, 3,
            "Repeated passes with no new ids must not re-emit notifications."
        )
    }

    private func invokeCheckForNotifications(on state: AppState) {
        state.checkForNotifications()
    }
}
