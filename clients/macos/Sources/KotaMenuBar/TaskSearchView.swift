import SwiftUI

/// Menu-bar surface for the daemon's on-demand repo task search. Mirrors the
/// body the Telegram `/tasks`, terminal `kota task search`, and daemon HTTP
/// `/tasks/search` already render — one shared search seam, one rendered line
/// shape across surfaces. The view binds to `AppState.tasks*` observables and
/// uses `DaemonClient.searchTasks` through the same wrapper every other
/// section uses; it does not reach into a parallel data layer or read the
/// file-backed `data/tasks/` queue directly.
struct TaskSearchView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: { isExpanded.toggle() }) {
                HStack {
                    Image(systemName: "list.bullet.rectangle")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("Tasks")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let badge = headerBadge {
                        TaskSearchStateBadge(label: badge.label, isActive: badge.isActive)
                    }
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
                TaskSearchExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        guard let result = appState.tasksResult else { return .secondary }
        switch result {
        case .success(let tasks):
            return tasks.isEmpty ? .secondary : .blue
        case .semanticUnavailable:
            return .orange
        }
    }

    private var headerBadge: (label: String, isActive: Bool)? {
        guard let result = appState.tasksResult else { return nil }
        switch result {
        case .success(let tasks):
            if tasks.isEmpty { return ("no matches", false) }
            return (tasks.count == 1 ? "1 task" : "\(tasks.count) tasks", true)
        case .semanticUnavailable:
            return ("semantic unavailable", false)
        }
    }
}

/// Active-vs-inactive label, driven by the typed `TasksSearchResponse`
/// branch — never inferred from the rendered text body.
struct TaskSearchStateBadge: View {
    let label: String
    let isActive: Bool

    var body: some View {
        Text(label)
            .font(.caption2)
            .foregroundStyle(isActive ? Color.blue : Color.secondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background((isActive ? Color.blue : Color.secondary).opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

struct TaskSearchExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TaskSearchQueryField()
            TaskSearchBodyView()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

struct TaskSearchQueryField: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass")
                .imageScale(.small)
                .foregroundStyle(.secondary)
            TextField("Search tasks…", text: $appState.tasksQuery)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .onSubmit { Task { await appState.loadTasksSearch() } }
            if appState.isLoadingTasksSearch {
                ProgressView().scaleEffect(0.5)
            }
        }
    }
}

struct TaskSearchBodyView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let err = appState.tasksError {
                TaskSearchErrorView(message: err)
            } else if appState.isLoadingTasksSearch && appState.tasksResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Searching…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredQuery {
                Text("Type a query to search tasks.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.tasksResult {
                switch result {
                case .success(let tasks):
                    if tasks.isEmpty {
                        Text("No matching tasks.")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(renderRepoTaskSearchPlain(tasks))
                            .font(.system(.caption, design: .monospaced))
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                case .semanticUnavailable:
                    Text("Semantic task search requires an embedding-backed repo-tasks provider.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text("Press return to search.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasEnteredQuery: Bool {
        !appState.tasksQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct TaskSearchErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadTasksSearch() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingTasksSearch)
        }
    }
}
