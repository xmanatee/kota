import SwiftUI

// MARK: - Operator IA
//
// The menu-bar popover groups daemon surfaces by operator intent rather
// than by backend seam. Each intent group lives in this file:
//
//   - MONITOR    : status header + active runs (declared inline in
//                   `MenuBarView`)
//   - RESPOND    : `AttentionInboxView` (approvals + owner questions +
//                   recent failed runs in one expandable group)
//   - ASK        : `AskUnifiedView` (one search/ask surface backed by a
//                   mode picker over the existing per-store seams)
//   - CAPTURE    : `ComposeSection` (capture by default, retract behind a
//                   segmented control to keep the destructive surface
//                   visually subordinate)
//   - BROWSE     : `BrowseSection` (collapsed by default — tasks queue,
//                   sessions, recent runs, daily digest, attention rollup)
//   - CONFIGURE  : `FooterActionsView` (trigger workflow, dashboard when
//                   advertised, set project, settings, notifications,
//                   quit)
//
// The per-store views in `KnowledgeView.swift`, `MemoryView.swift`, etc.
// are reused by `AskUnifiedView` instead of being mounted as siblings at
// the top of the popover. The previous fan-out — one collapsible section
// per backend seam — is gone.

// MARK: Section header

/// Small-caps label that introduces an intent group. Renders like the
/// secondary group headings in macOS Settings (uppercased, tracking,
/// muted) so the operator can scan the popover without parsing each
/// section title.
struct OperatorSectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.caption2)
            .fontWeight(.semibold)
            .tracking(0.6)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: Attention inbox

/// Pure summary of the attention queue used by `AttentionInboxView` and
/// its tests. Counts pending approvals, pending owner questions, and the
/// recent failed runs the operator has not yet seen. The split is
/// intentional: the SwiftUI body computes the same numbers from
/// `AppState`, but the helper lets us pin the badge text and the
/// "expanded by default" rule against fixtures without instantiating
/// `AppState`.
struct AttentionInboxSummary: Equatable {
    let approvals: Int
    let ownerQuestions: Int
    let failedRuns: Int

    var total: Int { approvals + ownerQuestions + failedRuns }
    var isEmpty: Bool { total == 0 }

    /// Compact badge text rendered inside the expandable header. Drops
    /// zero-count buckets so the line stays scannable.
    var badge: String {
        var parts: [String] = []
        if approvals > 0 {
            parts.append(approvals == 1 ? "1 approval" : "\(approvals) approvals")
        }
        if ownerQuestions > 0 {
            parts.append(ownerQuestions == 1 ? "1 question" : "\(ownerQuestions) questions")
        }
        if failedRuns > 0 {
            parts.append(failedRuns == 1 ? "1 failed run" : "\(failedRuns) failed runs")
        }
        return parts.joined(separator: " · ")
    }

    /// Header tint. Approvals / owner questions are blocking — they
    /// require an operator response to clear — so they push the header
    /// to red. A failed run alone is concerning but not blocking, so it
    /// stays orange. An empty queue stays muted.
    var tint: Color {
        if approvals > 0 || ownerQuestions > 0 { return .red }
        if failedRuns > 0 { return .orange }
        return .secondary
    }
}

func attentionInboxSummary(
    approvals: Int,
    ownerQuestions: Int,
    failedRuns: Int
) -> AttentionInboxSummary {
    AttentionInboxSummary(
        approvals: approvals,
        ownerQuestions: ownerQuestions,
        failedRuns: failedRuns
    )
}

/// Consolidates pending approvals, pending owner questions, and the
/// recent failed runs into one Respond group. The operator no longer
/// loses the "approvals" affordance below a wall of provider errors —
/// the count is visible in the header even when collapsed.
struct AttentionInboxView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded: Bool = false
    @State private var hasAutoExpanded: Bool = false

    private var failedRuns: [RunSummary] {
        appState.recentRuns.filter { $0.status == "failed" }
    }

    private var summary: AttentionInboxSummary {
        attentionInboxSummary(
            approvals: appState.pendingApprovals.count,
            ownerQuestions: appState.pendingOwnerQuestions.count,
            failedRuns: failedRuns.count
        )
    }

    var body: some View {
        if summary.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Divider()
                OperatorSectionHeader(title: "Respond")
                Button(action: { isExpanded.toggle() }) {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .imageScale(.small)
                            .foregroundStyle(summary.tint)
                        Text(summary.badge)
                            .font(.caption)
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .imageScale(.small)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("attention-inbox-toggle")
                .onAppear {
                    // Auto-expand once per session when the queue is
                    // non-empty so the operator does not have to discover
                    // an unread approval. Re-collapsing is sticky.
                    if !hasAutoExpanded && !summary.isEmpty {
                        isExpanded = true
                        hasAutoExpanded = true
                    }
                }

                if isExpanded {
                    AttentionInboxBody(failedRuns: failedRuns)
                }
            }
        }
    }
}

private struct AttentionInboxBody: View {
    @EnvironmentObject var appState: AppState
    let failedRuns: [RunSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(appState.pendingApprovals) { approval in
                ApprovalRow(approval: approval)
            }
            ForEach(appState.pendingOwnerQuestions) { question in
                OwnerQuestionRow(question: question)
            }
            ForEach(failedRuns) { run in
                AttentionFailedRunRow(run: run)
            }
        }
    }
}

/// Compact row for a recently failed workflow run. Tapping it opens the
/// same inline `RunDetailInlineView` that `RecentRunRow` uses, so the
/// operator can read the failure traceback without leaving the popover.
private struct AttentionFailedRunRow: View {
    let run: RunSummary
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false
    @State private var detail: RunDetail?
    @State private var isLoading = false
    @State private var loadError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggleExpansion) {
                HStack(spacing: 6) {
                    Image(systemName: "xmark.octagon.fill")
                        .imageScale(.small)
                        .foregroundStyle(.red)
                    Text(run.workflow)
                        .font(.system(.caption, design: .monospaced))
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer()
                    Text(run.durationDescription)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .imageScale(.small)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                RunDetailInlineView(
                    detail: detail,
                    isLoading: isLoading,
                    loadError: loadError,
                    onRefresh: { Task { await fetchDetail() } }
                )
            }
        }
    }

    private func toggleExpansion() {
        isExpanded.toggle()
        if isExpanded && detail == nil && !isLoading {
            Task { await fetchDetail() }
        }
    }

    private func fetchDetail() async {
        isLoading = true
        loadError = nil
        do {
            detail = try await appState.client.fetchRunDetail(runId: run.id)
        } catch {
            loadError = DaemonErrorPresenter.message(for: error)
        }
        isLoading = false
    }
}

// MARK: Ask unified surface

/// One operator-facing search mode. Each arm corresponds to an existing
/// daemon seam — the picker lets the operator switch the active query
/// without scrolling past one section per seam in the popover. The order
/// is intentional: `ask` (cited synthesis) is the default; `recall`
/// (cross-store ranking) sits second; the per-store search arms follow.
enum AskMode: String, CaseIterable, Identifiable, Hashable {
    case ask
    case recall
    case knowledge
    case memory
    case history
    case tasks

    var id: String { rawValue }

    var label: String {
        switch self {
        case .ask: return "Ask"
        case .recall: return "Recall"
        case .knowledge: return "Knowledge"
        case .memory: return "Memory"
        case .history: return "History"
        case .tasks: return "Tasks"
        }
    }

    var systemImage: String {
        switch self {
        case .ask: return "text.bubble"
        case .recall: return "sparkle.magnifyingglass"
        case .knowledge: return "books.vertical"
        case .memory: return "brain"
        case .history: return "clock.arrow.2.circlepath"
        case .tasks: return "list.bullet.rectangle"
        }
    }

    var placeholder: String {
        switch self {
        case .ask: return "Ask the second brain…"
        case .recall: return "Recall across stores…"
        case .knowledge: return "Search knowledge…"
        case .memory: return "Search memory…"
        case .history: return "Search history…"
        case .tasks: return "Search tasks…"
        }
    }
}

/// Unified search/ask surface. Replaces the six top-level collapsible
/// sections (Answer / Recall / Knowledge / Memory / History / Tasks)
/// with one search field plus a mode picker. The query, loading state,
/// error, and result for each arm still come from the existing
/// `AppState` observables — there is no parallel state, no parallel
/// load function, and no parallel result type.
struct AskUnifiedView: View {
    @EnvironmentObject var appState: AppState
    @State private var mode: AskMode = .ask

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            OperatorSectionHeader(title: "Ask")
            VStack(alignment: .leading, spacing: 6) {
                AskModePicker(mode: $mode)
                AskQueryField(mode: mode)
                AskResultBody(mode: mode)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        }
    }
}

private struct AskModePicker: View {
    @Binding var mode: AskMode

    var body: some View {
        Picker("Mode", selection: $mode) {
            ForEach(AskMode.allCases) { m in
                Label(m.label, systemImage: m.systemImage).tag(m)
            }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .accessibilityIdentifier("ask-mode-picker")
    }
}

private struct AskQueryField: View {
    @EnvironmentObject var appState: AppState
    let mode: AskMode

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass")
                .imageScale(.small)
                .foregroundStyle(.secondary)
            TextField(mode.placeholder, text: queryBinding)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .onSubmit { submit() }
                .accessibilityIdentifier("ask-query-\(mode.rawValue)")
            if isLoading {
                ProgressView().scaleEffect(0.5)
            }
        }
    }

    private var queryBinding: Binding<String> {
        switch mode {
        case .ask: return $appState.answerQuery
        case .recall: return $appState.recallQuery
        case .knowledge: return $appState.knowledgeQuery
        case .memory: return $appState.memoryQuery
        case .history: return $appState.historyQuery
        case .tasks: return $appState.tasksQuery
        }
    }

    private var isLoading: Bool {
        switch mode {
        case .ask: return appState.isLoadingAnswer
        case .recall: return appState.isLoadingRecall
        case .knowledge: return appState.isLoadingKnowledge
        case .memory: return appState.isLoadingMemory
        case .history: return appState.isLoadingHistory
        case .tasks: return appState.isLoadingTasksSearch
        }
    }

    private func submit() {
        Task {
            switch mode {
            case .ask: await appState.loadAnswer()
            case .recall: await appState.loadRecall()
            case .knowledge: await appState.loadKnowledge()
            case .memory: await appState.loadMemory()
            case .history: await appState.loadHistory()
            case .tasks: await appState.loadTasksSearch()
            }
        }
    }
}

private struct AskResultBody: View {
    @EnvironmentObject var appState: AppState
    let mode: AskMode

    var body: some View {
        Group {
            switch mode {
            case .ask: AnswerBodyView()
            case .recall: RecallBodyView()
            case .knowledge: KnowledgeBodyView()
            case .memory: MemoryBodyView()
            case .history: HistoryBodyView()
            case .tasks: TaskSearchBodyView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: Compose section (capture / retract)

enum ComposeMode: String, CaseIterable, Hashable {
    case capture
    case retract

    var label: String {
        switch self {
        case .capture: return "Capture"
        case .retract: return "Retract"
        }
    }
}

/// Compose surface. Capture is the default action the operator wants;
/// retract is destructive, so it sits behind a segmented control instead
/// of as a sibling top-level section. Each arm reuses the existing
/// expanded-content view so wire decoders, gates, and rendering stay in
/// one place.
struct ComposeSection: View {
    @EnvironmentObject var appState: AppState
    @State private var mode: ComposeMode = .capture

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            OperatorSectionHeader(title: "Capture")
            ComposeModePicker(mode: $mode)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
            switch mode {
            case .capture:
                CaptureExpandedContent()
            case .retract:
                RetractExpandedContent()
            }
        }
    }
}

private struct ComposeModePicker: View {
    @Binding var mode: ComposeMode

    var body: some View {
        Picker("", selection: $mode) {
            ForEach(ComposeMode.allCases, id: \.self) { m in
                Text(m.label).tag(m)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .accessibilityIdentifier("compose-mode-picker")
    }
}

// MARK: Browse section (collapsed)

/// Secondary surfaces — passive status the operator inspects rather
/// than acts on. Collapsed by default so the popover's first viewport
/// stays compact. Each child re-uses the existing collapsible view; the
/// top-level Browse disclosure is the new affordance, not the per-child
/// expansion.
struct BrowseSection: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded: Bool = false

    private var hasAnyContent: Bool {
        !appState.recentRuns.isEmpty
            || !appState.activeSessions.isEmpty
            || appState.taskQueue != nil
            || appState.diagnostic.isConnected
    }

    var body: some View {
        if !hasAnyContent {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Divider()
                Button(action: { isExpanded.toggle() }) {
                    HStack {
                        Image(systemName: "rectangle.stack")
                            .imageScale(.small)
                            .foregroundStyle(.secondary)
                        Text("Browse")
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .tracking(0.6)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .imageScale(.small)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("browse-section-toggle")

                if isExpanded {
                    VStack(alignment: .leading, spacing: 0) {
                        TaskQueueView()
                        SessionsView()
                        RecentRunsView()
                        DigestView()
                        AttentionView()
                    }
                }
            }
        }
    }
}

// MARK: Footer actions

/// Configure / control row at the bottom of the popover. Each affordance
/// has a clear contract:
///
///   - `Trigger Workflow…` opens the typed definitions picker.
///   - `Open Dashboard` only appears when the daemon advertises a
///     ready dashboard capability (see `AppState.isDashboardAvailable`).
///   - `Settings…` opens the macOS Settings scene already declared in
///     `KotaMenuBarApp` — no separate "Set Project Directory" prompt
///     row competing with it.
///   - The notification toggle is the only inline switch; it is paired
///     with a soft caption so it does not visually outrank the actions
///     above.
struct FooterActionsView: View {
    @EnvironmentObject var appState: AppState
    @Binding var showTriggerSheet: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()

            MenuActionButton(label: "Trigger Workflow…", icon: "play.circle") {
                showTriggerSheet = true
            }

            if appState.isDashboardAvailable {
                MenuActionButton(label: "Open Dashboard", icon: "safari") {
                    appState.openDashboard()
                }
            }

            MenuActionButton(label: "Settings…", icon: "gearshape") {
                appState.platform.openAppSettings()
            }

            MenuActionButton(label: "Refresh", icon: "arrow.clockwise") {
                Task { await appState.refresh() }
            }

            NotificationToggleRow()

            if appState.platform.supportsQuit {
                Divider()

                MenuActionButton(label: "Quit KOTA Menu Bar", icon: "xmark.circle") {
                    appState.platform.quitApp()
                }
            }
        }
        .padding(.bottom, 4)
    }
}
