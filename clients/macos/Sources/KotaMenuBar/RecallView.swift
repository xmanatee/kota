import SwiftUI

// Cross-store recall surface: the body, hit list, source badge, and
// error view are mounted inside `AskUnifiedView`
// (`OperatorSections.swift`).

/// Active-vs-inactive label, driven by the typed `RecallSearchResponse`
/// branch — never inferred from the rendered text body.
struct RecallStateBadge: View {
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

struct RecallBodyView: View {
    @EnvironmentObject var appState: AppState

    /// Single source of truth for the empty-query hint copy. The view body
    /// and `RecallViewTests.testRecallEmptyQueryHintEnumeratesFiveSources`
    /// both read this constant so the rendered copy stays lockstep with
    /// the closed `RecallSource` discriminator set
    /// (`knowledge | memory | history | tasks | answer`).
    static let emptyQueryHint =
        "Type a query to recall across knowledge, memory, history, tasks, and answer."

    var body: some View {
        Group {
            if let err = appState.recallError {
                RecallErrorView(message: err)
            } else if appState.isLoadingRecall && appState.recallResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Searching…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredQuery {
                Text(Self.emptyQueryHint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.recallResult {
                switch result {
                case .success(let hits):
                    if hits.isEmpty {
                        Text("No matching hits.")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        RecallHitsList(hits: hits)
                    }
                case .semanticUnavailable:
                    Text("Recall unavailable — no contributors registered.")
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
        !appState.recallQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Renders ranked hits in the order the daemon returns them (score descending,
/// `RECALL_SOURCE_ORDER` then id as the documented tie-breaker), so the macOS
/// surface preserves the same ordering the CLI, Telegram, and web client
/// already render.
struct RecallHitsList: View {
    let hits: [RecallHit]

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(hits.enumerated()), id: \.offset) { _, hit in
                RecallHitRow(hit: hit)
            }
        }
    }
}

struct RecallHitRow: View {
    let hit: RecallHit

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            RecallSourceBadge(source: hit.source)
            Text(String(format: "%.3f", hit.score))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            Text(hit.describe)
                .font(.caption)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}

/// Per-source badge tinted to match the web `RecallPanel` mapping
/// (`knowledge`→blue, `memory`→purple, `history`→green, `tasks`→orange).
/// Color drives the source column directly so the operator can scan
/// the four arms without parsing text.
struct RecallSourceBadge: View {
    let source: String

    var body: some View {
        Text(source)
            .font(.caption2)
            .foregroundStyle(tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(tint.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    private var tint: Color {
        switch source {
        case "knowledge": return .blue
        case "memory": return .purple
        case "history": return .green
        case "tasks": return .orange
        case "answer": return .pink
        default: return .secondary
        }
    }
}

struct RecallErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadRecall() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingRecall)
        }
    }
}
