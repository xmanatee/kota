import SwiftUI

/// Menu-bar surface for the daemon's on-demand knowledge search. Mirrors the
/// body the Telegram `/knowledge`, terminal `kota knowledge search`, daemon
/// HTTP `/api/knowledge/search`, and embedded web `KnowledgePanel` already
/// render — one shared search seam, five operator pull-surfaces (this file
/// is the fifth). The view binds to `AppState.knowledge*` observables and
/// uses `DaemonClient.searchKnowledge` through the same wrapper every other
/// section uses; it does not reach into a parallel data layer or read the
/// file-backed `KnowledgeStore` directly.
struct KnowledgeView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: { isExpanded.toggle() }) {
                HStack {
                    Image(systemName: "books.vertical")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("Knowledge")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let badge = headerBadge {
                        KnowledgeStateBadge(label: badge.label, isActive: badge.isActive)
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
                KnowledgeExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        guard let result = appState.knowledgeResult else { return .secondary }
        switch result {
        case .success(let entries):
            return entries.isEmpty ? .secondary : .blue
        case .semanticUnavailable:
            return .orange
        }
    }

    private var headerBadge: (label: String, isActive: Bool)? {
        guard let result = appState.knowledgeResult else { return nil }
        switch result {
        case .success(let entries):
            if entries.isEmpty { return ("no matches", false) }
            return (entries.count == 1 ? "1 entry" : "\(entries.count) entries", true)
        case .semanticUnavailable:
            return ("semantic unavailable", false)
        }
    }
}

/// Active-vs-inactive label, driven by the typed `KnowledgeSearchResponse`
/// branch — never inferred from the rendered text body.
struct KnowledgeStateBadge: View {
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

struct KnowledgeExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            KnowledgeQueryField()
            KnowledgeBodyView()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

struct KnowledgeQueryField: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass")
                .imageScale(.small)
                .foregroundStyle(.secondary)
            TextField("Search knowledge…", text: $appState.knowledgeQuery)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .onSubmit { Task { await appState.loadKnowledge() } }
            if appState.isLoadingKnowledge {
                ProgressView().scaleEffect(0.5)
            }
        }
    }
}

struct KnowledgeBodyView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let err = appState.knowledgeError {
                KnowledgeErrorView(message: err)
            } else if appState.isLoadingKnowledge && appState.knowledgeResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Searching…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredQuery {
                Text("Type a query to search knowledge.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.knowledgeResult {
                switch result {
                case .success(let entries):
                    if entries.isEmpty {
                        Text("No matching knowledge entries.")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text(renderKnowledgeSearchPlain(entries))
                            .font(.system(.caption, design: .monospaced))
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                case .semanticUnavailable:
                    Text("Semantic knowledge search requires an embedding-backed knowledge provider.")
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
        !appState.knowledgeQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct KnowledgeErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadKnowledge() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingKnowledge)
        }
    }
}
