import XCTest
@testable import KotaShared

/// Integrated coverage for the menu-bar `AppState` container itself,
/// not just the pure helpers that hang off it. Three flows are pinned:
///
///   - capability-driven dashboard gating (`isDashboardAvailable`,
///     `webUIURL`) — `MenuBarView` hides the "Open Dashboard" action
///     based on these and they were previously only covered by the
///     contract decoder, never against the live state container.
///   - offline reset — `refresh()` with no `projectDir` and no
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
        // The production `init` reads `projectDirectory` and
        // `remoteDaemonURL` from the shared `UserDefaults`. A previous
        // test run could have planted stale values in the test-process
        // suite, so wipe them before each construction.
        UserDefaults.standard.removeObject(forKey: "projectDirectory")
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

        state.identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/Users/op/Desktop/mono/apps/kota",
            projects: ProjectRegistryProjection(
                defaultProjectId: "p-test",
                projects: [
                    ConfiguredProjectEntry(projectId: "p-test", projectDir: "/Users/op/Desktop/mono/apps/kota", displayName: "kota")
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

        state.identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/Users/op/Desktop/mono/apps/kota",
            projects: ProjectRegistryProjection(
                defaultProjectId: "p-test",
                projects: [
                    ConfiguredProjectEntry(projectId: "p-test", projectDir: "/Users/op/Desktop/mono/apps/kota", displayName: "kota")
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

    func testRefreshWithNoProjectClearsEveryCachedBody() async {
        let state = makeState(notifications: RecordingNotifications())

        // Seed every cached on-demand body. If a future on-demand surface
        // lands without a paired entry in `clearOnDemandForOffline`, this
        // test will catch the regression — the offline branch must wipe
        // the lot so a stale rollup never paints over the disconnected
        // state.
        state.activeRuns = [
            ActiveRun(
                runId: "run-1",
                workflow: "builder",
                startedAt: "2026-04-29T00:00:00Z"
            )
        ]
        state.recentRuns = [
            RunSummary(
                id: "run-old",
                workflow: "builder",
                status: "success",
                startedAt: "2026-04-28T00:00:00Z",
                durationMs: 1000
            )
        ]
        state.identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/x",
            projects: ProjectRegistryProjection(
                defaultProjectId: "p-test",
                projects: [
                    ConfiguredProjectEntry(projectId: "p-test", projectDir: "/Users/op/Desktop/mono/apps/kota", displayName: "kota")
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        state.health = .running(1)
        state.knowledgeError = "stale"
        state.memoryError = "stale"
        state.historyError = "stale"
        state.tasksError = "stale"
        state.recallError = "stale"
        state.answerError = "stale"
        state.captureError = "stale"
        state.retractError = "stale"
        state.digestError = "stale"
        state.attentionError = "stale"
        state.isLoadingDigest = true
        state.isLoadingAttention = true
        state.isLoadingKnowledge = true
        state.isLoadingMemory = true
        state.isLoadingHistory = true
        state.isLoadingTasksSearch = true
        state.isLoadingRecall = true
        state.isLoadingAnswer = true
        state.isLoadingCapture = true
        state.isLoadingRetract = true
        state.retractConfirmed = true
        state.answerLogEntries = [
            AnswerHistoryEntry(
                id: "ans-stale",
                createdAt: "2026-04-29T00:00:00Z",
                query: "stale",
                result: .noHits
            )
        ]
        state.answerLogError = "stale"
        state.isLoadingAnswerLog = true
        state.answerLogHasMore = true
        state.answerShowOpenId = "ans-stale"
        state.answerShowMissing = true
        state.answerShowError = "stale"
        state.isLoadingAnswerShow = true
        state.projectDir = nil
        state.remoteURL = ""

        await state.refresh()

        if case .offline = state.health {
            // expected
        } else {
            XCTFail("offline branch must set health to .offline")
        }
        XCTAssertEqual(state.diagnostic, .noProject)
        XCTAssertTrue(state.activeRuns.isEmpty)
        XCTAssertTrue(state.recentRuns.isEmpty)
        XCTAssertNil(state.identity)
        XCTAssertNil(state.capabilities)
        XCTAssertTrue(state.workflowDefinitions.isEmpty)
        XCTAssertNil(state.digest)
        XCTAssertNil(state.digestError)
        XCTAssertFalse(state.isLoadingDigest)
        XCTAssertNil(state.attention)
        XCTAssertNil(state.attentionError)
        XCTAssertFalse(state.isLoadingAttention)
        XCTAssertNil(state.knowledgeResult)
        XCTAssertNil(state.knowledgeError)
        XCTAssertFalse(state.isLoadingKnowledge)
        XCTAssertNil(state.memoryResult)
        XCTAssertNil(state.memoryError)
        XCTAssertFalse(state.isLoadingMemory)
        XCTAssertNil(state.historyResult)
        XCTAssertNil(state.historyError)
        XCTAssertFalse(state.isLoadingHistory)
        XCTAssertNil(state.tasksResult)
        XCTAssertNil(state.tasksError)
        XCTAssertFalse(state.isLoadingTasksSearch)
        XCTAssertNil(state.recallResult)
        XCTAssertNil(state.recallError)
        XCTAssertFalse(state.isLoadingRecall)
        XCTAssertNil(state.answerResult)
        XCTAssertNil(state.answerError)
        XCTAssertFalse(state.isLoadingAnswer)
        XCTAssertNil(state.captureResult)
        XCTAssertNil(state.captureError)
        XCTAssertFalse(state.isLoadingCapture)
        XCTAssertNil(state.retractResult)
        XCTAssertNil(state.retractError)
        XCTAssertFalse(state.isLoadingRetract)
        XCTAssertFalse(state.retractConfirmed)
        XCTAssertTrue(state.answerLogEntries.isEmpty)
        XCTAssertNil(state.answerLogError)
        XCTAssertFalse(state.isLoadingAnswerLog)
        XCTAssertFalse(state.answerLogHasMore)
        XCTAssertNil(state.answerShowOpenId)
        XCTAssertNil(state.answerShowRecord)
        XCTAssertFalse(state.answerShowMissing)
        XCTAssertNil(state.answerShowError)
        XCTAssertFalse(state.isLoadingAnswerShow)
    }

    // MARK: - Active project selection

    func testReconcileActiveProjectIdSeedsDefaultThenPreservesValidSelection() {
        let state = makeState(notifications: RecordingNotifications())
        let projection = ProjectRegistryProjection(
            defaultProjectId: "p-default",
            projects: [
                ConfiguredProjectEntry(projectId: "p-default", projectDir: "/tmp/kota", displayName: "kota"),
                ConfiguredProjectEntry(projectId: "p-other", projectDir: "/tmp/other", displayName: "other"),
            ]
        )
        XCTAssertNil(state.activeProjectId)
        state.reconcileActiveProjectId(with: projection)
        XCTAssertEqual(state.activeProjectId, "p-default")

        // A subsequent reconcile with the same registry preserves the
        // current selection — the operator has not changed projects.
        state.reconcileActiveProjectId(with: projection)
        XCTAssertEqual(state.activeProjectId, "p-default")
    }

    func testReconcileActiveProjectIdResetsWhenSelectionDropsOutOfRegistry() {
        let state = makeState(notifications: RecordingNotifications())
        state.identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/tmp/kota",
            projects: ProjectRegistryProjection(
                defaultProjectId: "p-default",
                projects: [
                    ConfiguredProjectEntry(projectId: "p-default", projectDir: "/tmp/kota", displayName: "kota"),
                    ConfiguredProjectEntry(projectId: "p-other", projectDir: "/tmp/other", displayName: "other"),
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "t",
            dashboard: .available(path: "/")
        )
        state.setActiveProjectId("p-other")
        XCTAssertEqual(state.activeProjectId, "p-other")

        // After a config reload the registry no longer carries `p-other`.
        // The selection must collapse back to the registry's default
        // rather than render daemon rows belonging to a now-unknown id.
        let shrunken = ProjectRegistryProjection(
            defaultProjectId: "p-default",
            projects: [
                ConfiguredProjectEntry(projectId: "p-default", projectDir: "/tmp/kota", displayName: "kota"),
            ]
        )
        state.reconcileActiveProjectId(with: shrunken)
        XCTAssertEqual(state.activeProjectId, "p-default")
    }

    func testSetActiveProjectIdClearsProjectScopedStateImmediately() {
        let state = makeState(notifications: RecordingNotifications())
        state.identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/tmp/kota",
            projects: ProjectRegistryProjection(
                defaultProjectId: "p-default",
                projects: [
                    ConfiguredProjectEntry(projectId: "p-default", projectDir: "/tmp/kota", displayName: "kota"),
                    ConfiguredProjectEntry(projectId: "p-other", projectDir: "/tmp/other", displayName: "other"),
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "t",
            dashboard: .available(path: "/")
        )
        state.reconcileActiveProjectId(with: state.identity!.projects)
        XCTAssertEqual(state.activeProjectId, "p-default")
        state.activeRuns = [ActiveRun(runId: "r1", workflow: "builder", startedAt: "t")]
        state.recentRuns = [RunSummary(id: "r0", workflow: "builder", status: "success", startedAt: "t", durationMs: 1)]

        state.setActiveProjectId("p-other")
        XCTAssertEqual(state.activeProjectId, "p-other")
        XCTAssertTrue(state.activeRuns.isEmpty)
        XCTAssertTrue(state.recentRuns.isEmpty)
    }

    // MARK: - Project-scoped URL builder

    func testWithProjectAppendsQueryParam() {
        XCTAssertEqual(DaemonClient.withProject("/status", projectId: "p-1"), "/status?projectId=p-1")
        XCTAssertEqual(
            DaemonClient.withProject("/workflow/runs?limit=10", projectId: "p-1"),
            "/workflow/runs?limit=10&projectId=p-1"
        )
        XCTAssertEqual(DaemonClient.withProject("/status", projectId: nil), "/status")
        XCTAssertEqual(DaemonClient.withProject("/status", projectId: ""), "/status")
        XCTAssertEqual(
            DaemonClient.withProject("/sessions", projectId: "p with spaces"),
            "/sessions?projectId=p%20with%20spaces"
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
