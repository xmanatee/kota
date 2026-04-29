import SwiftUI

// Memory surface: the body and helpers are mounted inside
// `AskUnifiedView` (`OperatorSections.swift`).

/// Active-vs-inactive label, driven by the typed `MemorySearchResponse`
/// branch — never inferred from the rendered text body.
struct MemoryStateBadge: View {
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

struct MemoryBodyView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let err = appState.memoryError {
                MemoryErrorView(message: err)
            } else if appState.isLoadingMemory && appState.memoryResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Searching…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredQuery {
                Text("Type a query to search memory.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.memoryResult {
                switch result {
                case .success(let entries):
                    if entries.isEmpty {
                        Text("No matching memory entries.")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(renderMemorySearchPlain(entries))
                            .font(.system(.caption, design: .monospaced))
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                case .semanticUnavailable:
                    Text("Semantic memory search requires an embedding-backed memory provider.")
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
        !appState.memoryQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct MemoryErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadMemory() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingMemory)
        }
    }
}
