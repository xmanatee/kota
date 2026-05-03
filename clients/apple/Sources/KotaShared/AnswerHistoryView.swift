import SwiftUI

/// Menu-bar surface for the daemon's persisted cited-answer history.
/// Mirrors the read paths that already exist on every other operator
/// surface — mobile `AnswerHistoryScreen`, web `AnswerHistoryPanel`,
/// Telegram `/answer-log` and `/answer-show <id>`, CLI `kota answer
/// log` — by consuming the same `GET /answers` and `GET /answers/:id`
/// daemon-control routes through `DaemonClient.answerLog` and
/// `DaemonClient.answerShow`. Lives inside the existing operator
/// `BrowseSection` group, alongside DigestView and AttentionView, so
/// it follows the same collapsed-by-default browse IA the popover
/// already uses for passive read surfaces.
struct AnswerHistoryView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: toggleExpansion) {
                HStack {
                    Image(systemName: "text.book.closed")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("Answer History")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    AnswerHistoryHeaderBadge(
                        entryCount: appState.answerLogEntries.count,
                        hasError: appState.answerLogError != nil
                    )
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
            .accessibilityIdentifier("answer-history-toggle")

            if isExpanded {
                AnswerHistoryExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        if appState.answerLogError != nil { return .red }
        return appState.answerLogEntries.isEmpty ? .secondary : .blue
    }

    private func toggleExpansion() {
        isExpanded.toggle()
        if isExpanded
            && appState.answerLogEntries.isEmpty
            && appState.answerLogError == nil
            && !appState.isLoadingAnswerLog
        {
            Task { await appState.loadAnswerLog() }
        }
    }
}

/// Compact header badge — entries count or error tag — driven by typed
/// state, never inferred from the rendered text body. Hidden when the
/// list is empty and no error has been surfaced so the header stays
/// visually quiet.
struct AnswerHistoryHeaderBadge: View {
    let entryCount: Int
    let hasError: Bool

    var body: some View {
        if hasError {
            Text("error")
                .font(.caption2)
                .foregroundStyle(Color.red)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Color.red.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 3))
        } else if entryCount > 0 {
            Text("\(entryCount)")
                .font(.caption2)
                .foregroundStyle(Color.blue)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Color.blue.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 3))
        }
    }
}

struct AnswerHistoryExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if appState.answerShowOpenId != nil {
                AnswerHistoryDetailView()
            } else {
                AnswerHistoryListBody()
            }
        }
        .background(Color.secondary.opacity(0.07))
    }
}

struct AnswerHistoryListBody: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let err = appState.answerLogError {
                AnswerHistoryErrorBanner(message: err) {
                    Task { await appState.loadAnswerLog() }
                }
            } else if appState.isLoadingAnswerLog && appState.answerLogEntries.isEmpty {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Loading…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            } else if appState.answerLogEntries.isEmpty {
                Text("No answers in history yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            } else {
                ForEach(appState.answerLogEntries) { entry in
                    AnswerHistoryEntryRow(entry: entry) {
                        Task { await appState.openAnswerShow(id: entry.id) }
                    }
                }
                if appState.answerLogHasMore {
                    Button(action: { Task { await appState.loadMoreAnswerLog() } }) {
                        HStack(spacing: 4) {
                            if appState.isLoadingAnswerLog {
                                ProgressView().scaleEffect(0.5)
                            }
                            Text("Load older")
                                .font(.caption2)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderless)
                    .disabled(appState.isLoadingAnswerLog)
                    .accessibilityIdentifier("answer-history-load-more")
                }
            }
        }
    }
}

/// One entry row: created-at + result badge + truncated query. Tap to
/// open the detail view that re-renders the full record. The badge text
/// is driven by the typed `AnswerHistoryEntry.Result` arms — never
/// inferred from prose — so a payload drift fails decode upstream
/// instead of silently mis-coloring the row.
struct AnswerHistoryEntryRow: View {
    let entry: AnswerHistoryEntry
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: 6) {
                Text(entry.createdAt)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                AnswerHistoryResultBadge(result: entry.result)
                Text(entry.query)
                    .font(.caption)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("answer-history-row-\(entry.id)")
    }
}

struct AnswerHistoryResultBadge: View {
    let result: AnswerHistoryEntry.Result

    var body: some View {
        switch result {
        case .success(let count):
            Text(count == 1 ? "1 cite" : "\(count) cites")
                .font(.caption2)
                .foregroundStyle(Color.green)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Color.green.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 3))
        case .noHits:
            quietBadge(label: "no_hits")
        case .semanticUnavailable:
            quietBadge(label: "semantic_unavailable")
        case .synthesisFailed:
            quietBadge(label: "synthesis_failed")
        }
    }

    private func quietBadge(label: String) -> some View {
        Text(label)
            .font(.caption2)
            .foregroundStyle(Color.orange)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Color.orange.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

/// Detail re-render of one persisted envelope. Reuses
/// `AnswerResultView` so the displayed body for each `AnswerResult`
/// arm stays byte-identical to the live `Ask → ask` surface — the
/// menu-bar speaks one vocabulary across compose-now and history.
struct AnswerHistoryDetailView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button(action: { appState.closeAnswerShow() }) {
                    Label("Back", systemImage: "chevron.backward")
                        .font(.caption2)
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("answer-history-back")
                Spacer()
                if appState.isLoadingAnswerShow {
                    ProgressView().scaleEffect(0.5)
                }
            }
            if let err = appState.answerShowError {
                AnswerHistoryErrorBanner(message: err) {
                    if let id = appState.answerShowOpenId {
                        Task { await appState.openAnswerShow(id: id) }
                    }
                }
            } else if appState.answerShowMissing {
                Text("No answer record with that id.")
                    .font(.caption)
                    .foregroundStyle(Color.orange)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 4)
                    .background(Color.orange.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else if let record = appState.answerShowRecord {
                AnswerHistoryRecordBody(record: record)
            } else if appState.isLoadingAnswerShow {
                Text("Loading…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

struct AnswerHistoryRecordBody: View {
    let record: AnswerHistoryRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 2) {
                Text(record.id)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Text(record.createdAt)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                Text(record.query)
                    .font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            AnswerResultView(result: record.result)
        }
    }
}

struct AnswerHistoryErrorBanner: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onRetry) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityIdentifier("answer-history-retry")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}
