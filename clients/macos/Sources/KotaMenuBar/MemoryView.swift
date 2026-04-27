import SwiftUI

/// Menu-bar surface for the daemon's on-demand memory search. Mirrors the
/// body the Telegram `/memory`, terminal `kota memory search`, and daemon
/// HTTP `/api/memory/search` already render — one shared search seam, one
/// rendered line shape across surfaces. The view binds to `AppState.memory*`
/// observables and uses `DaemonClient.searchMemory` through the same wrapper
/// every other section uses; it does not reach into a parallel data layer or
/// read the file-backed `MemoryStore` directly.
struct MemoryView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: { isExpanded.toggle() }) {
                HStack {
                    Image(systemName: "brain")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("Memory")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let badge = headerBadge {
                        MemoryStateBadge(label: badge.label, isActive: badge.isActive)
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
                MemoryExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        guard let result = appState.memoryResult else { return .secondary }
        switch result {
        case .success(let entries):
            return entries.isEmpty ? .secondary : .blue
        case .semanticUnavailable:
            return .orange
        }
    }

    private var headerBadge: (label: String, isActive: Bool)? {
        guard let result = appState.memoryResult else { return nil }
        switch result {
        case .success(let entries):
            if entries.isEmpty { return ("no matches", false) }
            return (entries.count == 1 ? "1 entry" : "\(entries.count) entries", true)
        case .semanticUnavailable:
            return ("semantic unavailable", false)
        }
    }
}

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

struct MemoryExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            MemoryQueryField()
            MemoryBodyView()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

struct MemoryQueryField: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass")
                .imageScale(.small)
                .foregroundStyle(.secondary)
            TextField("Search memory…", text: $appState.memoryQuery)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .onSubmit { Task { await appState.loadMemory() } }
            if appState.isLoadingMemory {
                ProgressView().scaleEffect(0.5)
            }
        }
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
