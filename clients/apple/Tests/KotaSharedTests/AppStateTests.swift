import XCTest
@testable import KotaShared

/// Integrated coverage for the shared `AppState` container:
///   - offline reset clears daemon-owned runtime state;
///   - notification fan-out emits only newly observed attention;
///   - scope selection preserves a valid scope and resets stale state.
///
/// The second pass through
///     `checkForNotifications` must emit one notification per *new*
///     failed run, pending approval, and pending owner question, and
///     must not re-emit on a subsequent pass with the same ids.
///
/// Tests construct `AppState` through the production initializer
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

    // MARK: - Offline reset

    func testRefreshWithNoScopeClearsDaemonState() async {
        let state = makeState(notifications: RecordingNotifications())
        state.activeRuns = [ActiveRun(runId: "run-1", workflow: "builder", startedAt: "t")]
        state.recentRuns = [RunSummary(id: "run-0", workflow: "builder", status: "success", startedAt: "t", durationMs: 1)]
        state.uiSurfaceError = "stale"
        state.scopeRoot = nil
        state.remoteURL = ""

        await state.refresh()

        XCTAssertEqual(state.diagnostic, .noScope)
        XCTAssertTrue(state.activeRuns.isEmpty)
        XCTAssertTrue(state.recentRuns.isEmpty)
        XCTAssertNil(state.identity)
        XCTAssertNil(state.uiSurfaceBundle)
        XCTAssertNil(state.uiSurfaceError)
    }

    // MARK: - Active scope selection

    func testReconcileActiveScopeIdSeedsDefaultThenPreservesValidSelection() {
        let state = makeState(notifications: RecordingNotifications())
        let projection = scopeRegistry(
            defaultScopeId: "p-default",
            scopes: [
                directoryScope(scopeId: "p-default", scopeRoot: "/tmp/kota", displayName: "kota"),
                directoryScope(scopeId: "p-other", scopeRoot: "/tmp/other", displayName: "other"),
            ]
        )
        XCTAssertNil(state.activeScopeId)
        state.reconcileActiveScopeId(with: projection)
        XCTAssertEqual(state.activeScopeId, "p-default")

        // A subsequent reconcile with the same registry preserves the
        // current selection — the operator has not changed scopes.
        state.reconcileActiveScopeId(with: projection)
        XCTAssertEqual(state.activeScopeId, "p-default")
    }

    func testReconcileActiveScopeIdResetsWhenSelectionDropsOutOfRegistry() {
        let state = makeState(notifications: RecordingNotifications())
        state.identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/tmp/kota",
            scopeRegistry: scopeRegistry(
                defaultScopeId: "p-default",
                scopes: [
                    directoryScope(scopeId: "p-default", scopeRoot: "/tmp/kota", displayName: "kota"),
                    directoryScope(scopeId: "p-other", scopeRoot: "/tmp/other", displayName: "other"),
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "t",
            dashboard: .available(path: "/")
        )
        state.setActiveScopeId("p-other")
        XCTAssertEqual(state.activeScopeId, "p-other")

        // After a config reload the registry no longer carries `p-other`.
        // The selection must collapse back to the registry's default
        // rather than render daemon rows belonging to a now-unknown id.
        let shrunken = scopeRegistry(
            defaultScopeId: "p-default",
            scopes: [
                directoryScope(scopeId: "p-default", scopeRoot: "/tmp/kota", displayName: "kota"),
            ]
        )
        state.reconcileActiveScopeId(with: shrunken)
        XCTAssertEqual(state.activeScopeId, "p-default")
    }

    func testSetActiveScopeIdClearsScopeScopedStateImmediately() {
        let state = makeState(notifications: RecordingNotifications())
        state.identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/tmp/kota",
            scopeRegistry: scopeRegistry(
                defaultScopeId: "p-default",
                scopes: [
                    directoryScope(scopeId: "p-default", scopeRoot: "/tmp/kota", displayName: "kota"),
                    directoryScope(scopeId: "p-other", scopeRoot: "/tmp/other", displayName: "other"),
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "t",
            dashboard: .available(path: "/")
        )
        state.reconcileActiveScopeId(with: state.identity!.scopeRegistry)
        XCTAssertEqual(state.activeScopeId, "p-default")
        state.activeRuns = [ActiveRun(runId: "r1", workflow: "builder", startedAt: "t")]
        state.recentRuns = [RunSummary(id: "r0", workflow: "builder", status: "success", startedAt: "t", durationMs: 1)]

        state.setActiveScopeId("p-other")
        XCTAssertEqual(state.activeScopeId, "p-other")
        XCTAssertTrue(state.activeRuns.isEmpty)
        XCTAssertTrue(state.recentRuns.isEmpty)
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
        state.recentRuns = [
            RunSummary(id: "run-old", workflow: "builder", status: "failed", startedAt: "t0", durationMs: nil)
        ]
        state.pendingApprovals = [
            ApprovalRequest(
                id: "approval-old",
                tool: "shell",
                risk: "elevated",
                reason: "rm -rf /tmp/x",
                createdAt: "t0",
                status: "pending"
            )
        ]
        state.pendingOwnerQuestions = [
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
        state.recentRuns.append(
            RunSummary(id: "run-new", workflow: "decomposer", status: "failed", startedAt: "t1", durationMs: nil)
        )
        state.pendingApprovals.append(
            ApprovalRequest(
                id: "approval-new",
                tool: "git",
                risk: "elevated",
                reason: "push to remote",
                createdAt: "t1",
                status: "pending"
            )
        )
        state.pendingOwnerQuestions.append(
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
