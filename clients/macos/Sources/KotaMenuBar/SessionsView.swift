import SwiftUI

struct SessionsView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        let sessions = appState.activeSessions
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            HStack {
                Image(systemName: "terminal")
                    .imageScale(.small)
                    .foregroundStyle(sessions.isEmpty ? Color.secondary : Color.green)
                Text(sessions.isEmpty ? "Sessions" : "Sessions (\(sessions.count))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 4)

            if sessions.isEmpty {
                Text("No active sessions")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            } else {
                ForEach(sessions) { session in
                    SessionRow(session: session)
                }
            }
        }
    }
}

struct SessionRow: View {
    let session: SessionSummary

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.green)
                .frame(width: 6, height: 6)
            Text(String(session.id.prefix(8)))
                .font(.system(.caption, design: .monospaced))
                .fontWeight(.medium)
            Spacer()
            Text(session.elapsedDescription)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 3)
    }
}
