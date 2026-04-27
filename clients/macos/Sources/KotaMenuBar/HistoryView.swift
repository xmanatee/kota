import SwiftUI

/// Menu-bar surface for the daemon's on-demand history search. Mirrors the
/// body the Telegram `/history`, terminal `kota history search`, and daemon
/// HTTP `/api/history/search` already render — one shared search seam, one
/// rendered line shape across surfaces. The view binds to `AppState.history*`
/// observables and uses `DaemonClient.searchHistory` through the same wrapper
/// every other section uses; it does not reach into a parallel data layer or
/// read the file-backed `ConversationHistory` store directly.
struct HistoryView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: { isExpanded.toggle() }) {
                HStack {
                    Image(systemName: "clock.arrow.2.circlepath")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("History")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let badge = headerBadge {
                        HistoryStateBadge(label: badge.label, isActive: badge.isActive)
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
                HistoryExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        guard let result = appState.historyResult else { return .secondary }
        switch result {
        case .success(let conversations):
            return conversations.isEmpty ? .secondary : .blue
        case .semanticUnavailable:
            return .orange
        }
    }

    private var headerBadge: (label: String, isActive: Bool)? {
        guard let result = appState.historyResult else { return nil }
        switch result {
        case .success(let conversations):
            if conversations.isEmpty { return ("no matches", false) }
            return (conversations.count == 1 ? "1 conversation" : "\(conversations.count) conversations", true)
        case .semanticUnavailable:
            return ("semantic unavailable", false)
        }
    }
}

/// Active-vs-inactive label, driven by the typed `HistorySearchResponse`
/// branch — never inferred from the rendered text body.
struct HistoryStateBadge: View {
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

struct HistoryExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HistoryQueryField()
            HistoryBodyView()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

struct HistoryQueryField: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass")
                .imageScale(.small)
                .foregroundStyle(.secondary)
            TextField("Search history…", text: $appState.historyQuery)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .onSubmit { Task { await appState.loadHistory() } }
            if appState.isLoadingHistory {
                ProgressView().scaleEffect(0.5)
            }
        }
    }
}

struct HistoryBodyView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let err = appState.historyError {
                HistoryErrorView(message: err)
            } else if appState.isLoadingHistory && appState.historyResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Searching…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredQuery {
                Text("Type a query to search history.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.historyResult {
                switch result {
                case .success(let conversations):
                    if conversations.isEmpty {
                        Text("No matching conversations.")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(renderHistorySearchPlain(conversations))
                            .font(.system(.caption, design: .monospaced))
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                case .semanticUnavailable:
                    Text("Semantic history search requires an embedding-backed history provider.")
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
        !appState.historyQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct HistoryErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadHistory() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingHistory)
        }
    }
}
