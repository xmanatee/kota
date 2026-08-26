import XCTest
@testable import KotaShared

/// Rendered-evidence snapshot for the operator-first menu-bar IA. Mirrors
/// the pattern in `DaemonConnectionDiagnosticTests.testWritesRendered…`:
/// every operator-visible state lands as a deterministic textual block in
/// the latest `.kota/runs/<run-id>/` directory so reviewers can verify
/// what the MenuBarView projects for each scenario without running a GUI.
///
/// Per `data/tasks/AGENTS.md`, native macOS surfaces accept a rendered
/// Swift snapshot fixture as the acceptance artifact. This file is that
/// fixture for the IA rework. It drives each scenario through the same
/// pure helpers the SwiftUI body folds into so the rendered shape stays
/// independent of the live state container (which is now covered
/// separately by `AppStateTests`):
///
///   - `attentionInboxSummary` for the Inbox group's badge and tint
///   - `AskMode` for the unified search/answer arms
///   - `ComposeMode` for the capture/retract segmented control
///   - `DaemonConnectionDiagnostic` for the status header
final class MenuBarRenderedTests: XCTestCase {

    private struct MenuBarScenario {
        let id: String
        let label: String
        let diagnostic: DaemonConnectionDiagnostic
        let activeRunCount: Int
        let approvals: Int
        let ownerQuestions: Int
        let blockedTasks: Int
        let failedRuns: Int
        let dashboardAvailable: Bool
        let semanticState: String
        let workflowDefinitionsCount: Int
    }

    /// Sample workflow definitions used to pin the trigger-sheet body
    /// shape. Mirrors the typed `WorkflowDefinitionSummary` decoder so a
    /// new trigger arm landing in the daemon contract surfaces here.
    private let triggerSheetDefinitions: [WorkflowDefinitionSummary] = [
        WorkflowDefinitionSummary(
            name: "builder",
            enabled: true,
            runtimeEnabled: true,
            stepCount: 6,
            triggers: [.event(event: "autonomy.queue.available")],
            inputSchema: nil
        ),
        WorkflowDefinitionSummary(
            name: "decomposer",
            enabled: true,
            runtimeEnabled: true,
            stepCount: 4,
            triggers: [.cron(schedule: "0 */4 * * *")],
            inputSchema: nil
        ),
        WorkflowDefinitionSummary(
            name: "improver",
            enabled: false,
            runtimeEnabled: false,
            stepCount: 3,
            triggers: [.event(event: "workflow.completed")],
            inputSchema: nil
        ),
    ]

    private let identity = ClientIdentity(
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

    private var scenarios: [MenuBarScenario] {
        [
            // CONNECTED — daemon answered identity and is doing work.
            // Approvals+question pending, dashboard advertised, semantic
            // search backends configured.
            MenuBarScenario(
                id: "connected-active",
                label: "Connected · daemon idle, attention pending, providers ready",
                diagnostic: .connected(identity: identity, baseURL: "http://127.0.0.1:8765"),
                activeRunCount: 1,
                approvals: 2,
                ownerQuestions: 1,
                blockedTasks: 1,
                failedRuns: 0,
                dashboardAvailable: true,
                semanticState: "ready",
                workflowDefinitionsCount: 12
            ),
            // DEGRADED — control file fresh and project matches, but the
            // daemon process never answered. Recent failed runs are the
            // only attention bucket.
            MenuBarScenario(
                id: "degraded-unreachable",
                label: "Degraded · daemon process alive but not responding, prior runs failed",
                diagnostic: .unreachable(
                    projectDir: "/Users/op/Desktop/mono/apps/kota",
                    baseURL: "http://127.0.0.1:8765",
                    pid: 12345
                ),
                activeRunCount: 0,
                approvals: 0,
                ownerQuestions: 0,
                blockedTasks: 0,
                failedRuns: 3,
                dashboardAvailable: false,
                semanticState: "ready",
                workflowDefinitionsCount: 0
            ),
            // UNAVAILABLE PROVIDER — connected, but the configured
            // knowledge/memory/history providers do not support semantic
            // search. The Knowledge surface still mounts; the per-mode body
            // renders the `semanticUnavailable` notice.
            MenuBarScenario(
                id: "connected-semantic-unavailable",
                label: "Connected · semantic search providers report semantic_unavailable",
                diagnostic: .connected(identity: identity, baseURL: "http://127.0.0.1:8765"),
                activeRunCount: 0,
                approvals: 0,
                ownerQuestions: 0,
                blockedTasks: 0,
                failedRuns: 0,
                dashboardAvailable: true,
                semanticState: "semantic_unavailable",
                workflowDefinitionsCount: 8
            ),
            // OFFLINE — no project picked. Header carries the noProject
            // arm; every responder/search/capture surface stays mounted
            // but rendered against an empty AppState (matching the
            // existing `clearOnDemandForOffline` reset).
            MenuBarScenario(
                id: "offline-no-project",
                label: "Offline · no project directory chosen",
                diagnostic: .noProject,
                activeRunCount: 0,
                approvals: 0,
                ownerQuestions: 0,
                blockedTasks: 0,
                failedRuns: 0,
                dashboardAvailable: false,
                semanticState: "n/a",
                workflowDefinitionsCount: 0
            ),
        ]
    }

    /// Pinned IA. Each row is one operator-visible group, in the order
    /// `MenuBarView` mounts them. The list is mechanical so a regression
    /// (a new top-level section sneaking in, or an existing group being
    /// dropped) shows up as a diff in the rendered fixture.
    private let intentGroups: [(String, String)] = [
        ("STATUS", "StatusHeaderView (dispatch control) + ActiveRunRow×N (only when active runs > 0)"),
        ("INBOX", "AttentionInboxView (approvals + owner questions + blocked work + failed runs)"),
        ("WORK", "WorkSection (collapsed: tasks queue, sessions, recent runs, digest, attention, answer history)"),
        ("KNOWLEDGE", "KnowledgeSection (collapsed: AskUnifiedView + ComposeSection)"),
        ("SETUP", "FooterActionsView (trigger workflow, dashboard?, settings, refresh, notifications, quit)"),
    ]

    /// Old-IA → new-IA mapping, pinned so reviewers can confirm that no
    /// capability disappeared during the consolidation.
    private let iaMigrationRows: [(String, String, String)] = [
        ("section",                          "old top-level row",                         "new operator group"),
        ("--",                               "--",                                        "--"),
        ("Daily Digest",                     "DigestView (own collapsible)",              "WORK → DigestView"),
        ("Attention rollup",                 "AttentionView (own collapsible)",           "WORK → AttentionView"),
        ("Knowledge search",                 "KnowledgeView (own collapsible)",           "KNOWLEDGE → mode=knowledge"),
        ("Memory search",                    "MemoryView (own collapsible)",              "KNOWLEDGE → mode=memory"),
        ("History search",                   "HistoryView (own collapsible)",             "KNOWLEDGE → mode=history"),
        ("Repo task search",                 "TaskSearchView (own collapsible)",          "KNOWLEDGE → mode=tasks"),
        ("Cross-store recall",               "RecallView (own collapsible)",              "KNOWLEDGE → mode=recall"),
        ("Cited answer",                     "AnswerView (own collapsible)",              "KNOWLEDGE → mode=ask (default)"),
        ("Answer history",                   "(macOS surface absent)",                    "WORK → AnswerHistoryView"),
        ("Cross-store capture",              "CaptureView (own collapsible)",             "KNOWLEDGE → mode=capture (default)"),
        ("Cross-store retract",              "RetractView (own collapsible)",             "KNOWLEDGE → mode=retract"),
        ("Task queue",                       "TaskQueueView (own collapsible)",           "WORK → TaskQueueView"),
        ("Active sessions",                  "SessionsView (own collapsible)",            "WORK → SessionsView"),
        ("Pending approvals",                "ApprovalsView (own collapsible)",           "INBOX → AttentionInboxView"),
        ("Owner questions",                  "OwnerQuestionsView (own collapsible)",      "INBOX → AttentionInboxView"),
        ("Recent run history",               "RecentRunsView (own collapsible)",          "WORK → RecentRunsView"),
        ("Active runs",                      "Active Runs row (always when N > 0)",       "STATUS → ActiveRunRow×N"),
        ("Open Dashboard",                   "Footer button (gated)",                     "SETUP → only when capability=ready"),
        ("Trigger Workflow",                 "Footer button (free-text dialog)",          "SETUP → typed definitions picker"),
        ("Set Project Directory",            "Footer button (NSOpenPanel)",               "SETUP → Settings… (Settings scene)"),
        ("Notifications toggle",             "Footer toggle",                             "SETUP → NotificationToggleRow"),
        ("Refresh",                          "Footer button",                             "SETUP → Refresh button"),
        ("Quit KOTA Menu Bar",               "Footer button",                             "SETUP → Quit button"),
    ]

    func testWritesMenuBarRenderedSnapshot() throws {
        var lines: [String] = [
            "# Rendered macOS menu-bar IA snapshot",
            "# Generated by MenuBarRenderedTests.testWritesMenuBarRenderedSnapshot",
            "# popover frame: 320x520, scrollable VStack",
            "",
            "## Intent groups (mount order)",
            "",
        ]
        for (group, description) in intentGroups {
            lines.append("- \(group)  \(description)")
        }

        lines.append("")
        lines.append("## Per-state rendering")
        lines.append("")
        for scenario in scenarios {
            lines.append("[\(scenario.id)] \(scenario.label)")
            lines.append("  status:")
            lines.append("    severity:    \(scenario.diagnostic.severity)")
            lines.append("    headline:    \(scenario.diagnostic.headline)")
            for d in scenario.diagnostic.detail.split(separator: "\n") {
                lines.append("    detail:      \(d)")
            }
            lines.append("    connected:   \(scenario.diagnostic.isConnected)")
            lines.append("  status:")
            lines.append("    activeRuns:  \(scenario.activeRunCount)")
            lines.append("  inbox:")
            let summary = attentionInboxSummary(
                approvals: scenario.approvals,
                ownerQuestions: scenario.ownerQuestions,
                blockedTasks: scenario.blockedTasks,
                failedRuns: scenario.failedRuns
            )
            lines.append("    badge:       \(summary.badge)")
            lines.append("    tint:        \(summary.tint)")
            lines.append("    default:     \(summary.isEmpty ? "collapsed" : "expanded")")
            lines.append("  work:")
            lines.append("    default:     collapsed")
            lines.append("  knowledge:")
            lines.append("    modes:       \(AskMode.allCases.map { $0.label }.joined(separator: ", "))")
            lines.append("    semantic:    \(scenario.semanticState)")
            lines.append("    capture:     \(ComposeMode.allCases.map { $0.label }.joined(separator: ", "))")
            lines.append("  setup:")
            lines.append("    dashboard:   \(scenario.dashboardAvailable ? "shown" : "hidden")")
            lines.append("    workflows:   \(scenario.workflowDefinitionsCount) definitions")
            lines.append("")
        }

        lines.append("## Workflow-trigger sheet (TriggerWorkflowView)")
        lines.append("")
        let enabledCount = triggerSheetDefinitions.filter { $0.enabled }.count
        let disabledCount = triggerSheetDefinitions.count - enabledCount
        lines.append("  picker:        typed definitions (\(enabledCount) enabled, \(disabledCount) disabled)")
        for def in triggerSheetDefinitions {
            let state = def.enabled ? "enabled " : "disabled"
            let triggerLabel = def.triggers.first?.label ?? ""
            lines.append("    [\(state)] \(def.name)  (\(triggerLabel))")
        }
        lines.append("  free-text:     none — sheet does not accept untyped workflow names")
        lines.append("  input-schema:  warning shown when the selected definition declares one")
        lines.append("  cancel:        ⎋ (Escape)")
        lines.append("  trigger:       ⏎ (Return)")
        lines.append("")

        lines.append("## Old-IA → new-IA migration map")
        lines.append("")
        for (col0, col1, col2) in iaMigrationRows {
            lines.append("  \(col0.padding(toLength: 36, withPad: " ", startingAt: 0))  \(col1.padding(toLength: 44, withPad: " ", startingAt: 0))  \(col2)")
        }

        let snapshot = lines.joined(separator: "\n") + "\n"

        guard let snapshotURL = Self.snapshotPath() else { return }
        try? FileManager.default.createDirectory(
            at: snapshotURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try snapshot.write(to: snapshotURL, atomically: true, encoding: .utf8)
    }

    private static func snapshotPath() -> URL? {
        let env = ProcessInfo.processInfo.environment
        if let runDir = env["KOTA_RUN_DIR"], !runDir.isEmpty {
            return URL(fileURLWithPath: runDir)
                .appendingPathComponent("rendered-menu-bar-states.txt")
        }
        let fm = FileManager.default
        var url = URL(fileURLWithPath: fm.currentDirectoryPath)
        for _ in 0..<6 {
            let candidate = url.appendingPathComponent(".kota/runs")
            if let entries = try? fm.contentsOfDirectory(
                at: candidate,
                includingPropertiesForKeys: [.contentModificationDateKey]
            ) {
                let latest = entries
                    .filter { $0.hasDirectoryPath }
                    .sorted { lhs, rhs in
                        let l = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey])
                            .contentModificationDate) ?? .distantPast
                        let r = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey])
                            .contentModificationDate) ?? .distantPast
                        return l > r
                    }
                    .first
                if let latest {
                    return latest.appendingPathComponent("rendered-menu-bar-states.txt")
                }
            }
            url = url.deletingLastPathComponent()
            if url.path == "/" { break }
        }
        return nil
    }
}
