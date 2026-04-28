import SwiftUI

struct MenuBarView: View {
    @EnvironmentObject var appState: AppState
    @State private var showTriggerSheet = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Status header
            StatusHeaderView()

            // Active runs
            if !appState.activeRuns.isEmpty {
                Divider()
                Text("Active Runs")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 4)

                ForEach(appState.activeRuns) { run in
                    ActiveRunRow(run: run)
                }
            }

            // Recent runs history
            RecentRunsView()

            // Daily digest (on-demand /api/digest)
            DigestView()

            // Attention rollup (on-demand /api/attention)
            AttentionView()

            // Knowledge search (on-demand /api/knowledge/search)
            KnowledgeView()

            // Memory search (on-demand /api/memory/search)
            MemoryView()

            // History search (on-demand /api/history/search)
            HistoryView()

            // Repo task search (on-demand /tasks/search)
            TaskSearchView()

            // Cross-store recall (on-demand POST /recall)
            RecallView()

            // Cited answer (on-demand POST /answer)
            AnswerView()

            // Cross-store capture (on-demand POST /capture)
            CaptureView()

            // Task queue
            TaskQueueView()

            // Active sessions
            SessionsView()

            // Pending approvals
            ApprovalsView()

            // Pending owner questions
            OwnerQuestionsView()

            // Footer actions
            Divider().padding(.top, 4)

            VStack(spacing: 0) {
                MenuActionButton(label: "Refresh", icon: "arrow.clockwise") {
                    Task { await appState.refresh() }
                }

                MenuActionButton(label: "Trigger Workflow…", icon: "play.circle") {
                    showTriggerSheet = true
                }

                MenuActionButton(label: "Open Dashboard", icon: "safari") {
                    appState.openDashboard()
                }

                MenuActionButton(label: "Set Project Directory…", icon: "folder") {
                    appState.promptForProjectDirectory()
                }

                NotificationToggleRow()

                Divider()

                MenuActionButton(label: "Quit KOTA Menu Bar", icon: "xmark.circle") {
                    NSApplication.shared.terminate(nil)
                }
            }
            .padding(.bottom, 4)
        }
        .frame(width: 280)
        .sheet(isPresented: $showTriggerSheet) {
            TriggerWorkflowView()
                .environmentObject(appState)
        }
        .onAppear { appState.isPopoverOpen = true }
        .onDisappear { appState.isPopoverOpen = false }
    }
}

struct StatusHeaderView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: appState.health.systemImageName)
                .foregroundStyle(healthColor)
                .imageScale(.medium)

            VStack(alignment: .leading, spacing: 1) {
                Text("KOTA")
                    .font(.headline)
                Text(appState.health.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if appState.connectionMode == .remote {
                Label("Remote", systemImage: "network")
                    .font(.caption2)
                    .foregroundStyle(.blue)
            } else if appState.projectDir == nil {
                Text("No project")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    var healthColor: Color {
        switch appState.health {
        case .idle: return .green
        case .running: return .orange
        case .error: return .red
        case .offline, .unknown: return .secondary
        }
    }
}

struct ActiveRunRow: View {
    let run: ActiveRun
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false
    @State private var detail: RunDetail?
    @State private var isLoading = false
    @State private var loadError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggleExpansion) {
                HStack {
                    Image(systemName: "arrow.2.circlepath")
                        .imageScale(.small)
                        .foregroundStyle(.orange)
                    Text(run.workflow)
                        .font(.system(.body, design: .monospaced))
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer()
                    Text(run.elapsedDescription)
                        .font(.caption)
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
            detail = try await appState.client.fetchRunDetail(runId: run.runId)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct RunDetailInlineView: View {
    let detail: RunDetail?
    let isLoading: Bool
    let loadError: String?
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            Group {
                if isLoading {
                    HStack(spacing: 4) {
                        ProgressView().scaleEffect(0.6)
                        Text("Loading…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else if let err = loadError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                } else if let d = detail {
                    RunDetailContent(detail: d)
                }
            }
            Spacer(minLength: 0)
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .imageScale(.small)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .disabled(isLoading)
            .padding(.top, 1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

struct RunDetailContent: View {
    let detail: RunDetail

    private var recentSteps: [RunStepSummary] {
        Array(detail.steps.suffix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let step = detail.currentStep {
                HStack(spacing: 4) {
                    stepStatusIcon(step.status)
                    Text(step.id)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if step.durationMs > 0 {
                        Text(formatDuration(step.durationMs))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let err = step.error {
                    Text(err.prefix(200))
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if detail.steps.count > 1 {
                Text(stepSnippet)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var stepSnippet: String {
        recentSteps.map { s in
            let dur = s.durationMs > 0 ? " (\(formatDuration(s.durationMs)))" : ""
            let icon = s.status == "completed" ? "✓" : s.status == "failed" ? "✗" : "›"
            return "\(icon) \(s.id)\(dur)"
        }.joined(separator: "\n")
    }

    private func formatDuration(_ ms: Double) -> String {
        let s = Int(ms / 1000)
        return s < 60 ? "\(s)s" : "\(s / 60)m \(s % 60)s"
    }

    @ViewBuilder
    private func stepStatusIcon(_ status: String) -> some View {
        switch status {
        case "running":
            Image(systemName: "circle.fill")
                .imageScale(.small)
                .foregroundStyle(.orange)
        case "completed":
            Image(systemName: "checkmark.circle.fill")
                .imageScale(.small)
                .foregroundStyle(.green)
        case "failed":
            Image(systemName: "xmark.circle.fill")
                .imageScale(.small)
                .foregroundStyle(.red)
        default:
            Image(systemName: "circle")
                .imageScale(.small)
                .foregroundStyle(.secondary)
        }
    }
}

struct RecentRunsView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        guard !appState.recentRuns.isEmpty else { return AnyView(EmptyView()) }
        return AnyView(content)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: { isExpanded.toggle() }) {
                HStack {
                    Image(systemName: "clock.arrow.circlepath")
                        .imageScale(.small)
                        .foregroundStyle(.secondary)
                    Text("Recent Runs")
                        .font(.caption)
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

            if isExpanded {
                ForEach(appState.recentRuns) { run in
                    RecentRunRow(run: run)
                }
            }
        }
    }
}

struct RecentRunRow: View {
    let run: RunSummary
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false
    @State private var detail: RunDetail?
    @State private var isLoading = false
    @State private var loadError: String?

    var statusColor: Color {
        switch run.status {
        case "success": return .green
        case "failed": return .red
        case "interrupted", "completed-with-warnings": return .orange
        default: return .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggleExpansion) {
                HStack {
                    Image(systemName: run.statusIcon)
                        .imageScale(.small)
                        .foregroundStyle(statusColor)
                    Text(run.workflow)
                        .font(.system(.body, design: .monospaced))
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer()
                    Text(run.durationDescription)
                        .font(.caption)
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
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

struct TaskQueueView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    private var doingTask: TaskDetail? { appState.taskQueue?.tasks.doing.first }
    private var hasDoingTask: Bool { doingTask != nil }

    var body: some View {
        let queue = appState.taskQueue
        guard queue != nil || hasDoingTask else { return AnyView(EmptyView()) }
        return AnyView(taskQueueContent(queue: queue))
    }

    @ViewBuilder
    private func taskQueueContent(queue: TaskQueueResponse?) -> some View {
        Divider()
        Button(action: { isExpanded.toggle() }) {
            HStack {
                Image(systemName: "checklist")
                    .imageScale(.small)
                    .foregroundStyle(hasDoingTask ? .orange : .secondary)
                Text("Task Queue")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if let task = doingTask {
                    Text(task.priority)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .imageScale(.small)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onAppear { isExpanded = hasDoingTask }
        .onChange(of: hasDoingTask) { newValue in
            if newValue { isExpanded = true }
        }

        if isExpanded {
            if let task = doingTask {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.2.circlepath")
                        .imageScale(.small)
                        .foregroundStyle(.orange)
                    Text(task.title)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 3)
            } else {
                Text("idle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 3)
            }

            if let q = queue {
                let ready = q.counts.ready
                let backlog = q.counts.backlog
                Text("\(ready) ready · \(backlog) backlog")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 4)
            }
        }
    }
}

struct NotificationToggleRow: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Toggle(isOn: $appState.notificationsEnabled) {
            Label("Notifications", systemImage: "bell")
        }
        .toggleStyle(.switch)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .font(.body)
    }
}

struct MenuActionButton: View {
    let label: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: icon)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color.clear)
    }
}
