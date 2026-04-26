import SwiftUI

/// Menu-bar surface for the daemon's on-demand attention rollup. Mirrors the
/// body the Telegram `/attention`, terminal `kota attention`, daemon HTTP
/// `/api/attention`, and embedded web `AttentionPanel` already render — one
/// shared on-demand seam, five operator pull-surfaces (this file is the fifth).
struct AttentionView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: toggleExpansion) {
                HStack {
                    Image(systemName: "exclamationmark.bubble")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("Attention")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let attention = appState.attention {
                        AttentionStateBadge(itemCount: attention.data.items.count)
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
                AttentionExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        guard let attention = appState.attention else { return .secondary }
        return attention.data.items.isEmpty ? .secondary : .orange
    }

    private func toggleExpansion() {
        isExpanded.toggle()
        if isExpanded
            && appState.attention == nil
            && appState.attentionError == nil
            && !appState.isLoadingAttention
        {
            Task { await appState.loadAttention() }
        }
    }
}

/// Pending-vs-quiet label, driven by `data.items.count` from the daemon
/// payload. Zero items means the seam returned `NO_ATTENTION_ITEMS_TEXT`,
/// so the badge says "nothing pending"; the count is never inferred from
/// the rendered text body.
struct AttentionStateBadge: View {
    let itemCount: Int

    var body: some View {
        Text(label)
            .font(.caption2)
            .foregroundStyle(itemCount == 0 ? Color.secondary : Color.orange)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background((itemCount == 0 ? Color.secondary : Color.orange).opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    private var label: String {
        if itemCount == 0 { return "nothing pending" }
        return itemCount == 1 ? "1 item" : "\(itemCount) items"
    }
}

struct AttentionExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if appState.isLoadingAttention && appState.attention == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Loading…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            } else if let err = appState.attentionError {
                AttentionErrorView(message: err)
            } else if let attention = appState.attention {
                AttentionBodyView(attention: attention)
            } else {
                Text("Tap to load attention")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }
        }
        .background(Color.secondary.opacity(0.07))
    }
}

struct AttentionBodyView: View {
    @EnvironmentObject var appState: AppState
    let attention: AttentionResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(attention.text)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            HStack {
                if appState.isLoadingAttention {
                    ProgressView().scaleEffect(0.5)
                    Text("Refreshing…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: { Task { await appState.loadAttention() } }) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .font(.caption2)
                }
                .buttonStyle(.borderless)
                .disabled(appState.isLoadingAttention)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

struct AttentionErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadAttention() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingAttention)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}
