import SwiftUI

/// Menu-bar surface for the daemon's on-demand 24h digest. Mirrors the body
/// the Telegram `/digest`, terminal `kota digest`, daemon HTTP `/api/digest`,
/// and embedded web `DigestPanel` already render — one shared on-demand
/// seam, five operator pull-surfaces.
struct DigestView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: toggleExpansion) {
                HStack {
                    Image(systemName: "doc.text.magnifyingglass")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("Daily Digest")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let digest = appState.digest {
                        DigestStateBadge(quiet: digest.data.quiet)
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
                DigestExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        guard let digest = appState.digest else { return .secondary }
        return digest.data.quiet ? .secondary : .blue
    }

    private func toggleExpansion() {
        isExpanded.toggle()
        if isExpanded
            && appState.digest == nil
            && appState.digestError == nil
            && !appState.isLoadingDigest
        {
            Task { await appState.loadDigest() }
        }
    }
}

/// Quiet-window vs active label, driven by `data.quiet` from the daemon
/// payload — never inferred from the rendered text body.
struct DigestStateBadge: View {
    let quiet: Bool

    var body: some View {
        Text(quiet ? "quiet window" : "active")
            .font(.caption2)
            .foregroundStyle(quiet ? Color.secondary : Color.green)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background((quiet ? Color.secondary : Color.green).opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

struct DigestExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if appState.isLoadingDigest && appState.digest == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Loading…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            } else if let err = appState.digestError {
                DigestErrorView(message: err)
            } else if let digest = appState.digest {
                DigestBodyView(digest: digest)
            } else {
                Text("Tap to load digest")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }
        }
        .background(Color.secondary.opacity(0.07))
    }
}

struct DigestBodyView: View {
    @EnvironmentObject var appState: AppState
    let digest: DigestResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(digest.text)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            HStack {
                if appState.isLoadingDigest {
                    ProgressView().scaleEffect(0.5)
                    Text("Refreshing…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: { Task { await appState.loadDigest() } }) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .font(.caption2)
                }
                .buttonStyle(.borderless)
                .disabled(appState.isLoadingDigest)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

struct DigestErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadDigest() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingDigest)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}
