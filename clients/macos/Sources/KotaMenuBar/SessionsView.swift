import SwiftUI

struct SessionsView: View {
    @EnvironmentObject var appState: AppState
    @State private var chatSessionId: String?
    @State private var isCreatingSession = false

    var body: some View {
        let sessions = appState.activeSessions
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "terminal")
                        .imageScale(.small)
                        .foregroundStyle(sessions.isEmpty ? Color.secondary : Color.green)
                    Text(sessions.isEmpty ? "Sessions" : "Sessions (\(sessions.count))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: createNewSession) {
                    if isCreatingSession {
                        ProgressView().scaleEffect(0.5).frame(width: 14, height: 14)
                    } else {
                        Image(systemName: "plus.circle")
                            .imageScale(.small)
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isCreatingSession || appState.projectDir == nil)
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
                    SessionRow(session: session) {
                        chatSessionId = session.id
                    }
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { chatSessionId != nil },
            set: { if !$0 { chatSessionId = nil } }
        )) {
            if let id = chatSessionId {
                ChatView(sessionId: id)
                    .environmentObject(appState)
            }
        }
    }

    private func createNewSession() {
        isCreatingSession = true
        Task {
            if let id = await appState.createSession() {
                await appState.refresh()
                chatSessionId = id
            }
            isCreatingSession = false
        }
    }
}

struct SessionRow: View {
    let session: SessionSummary
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                Circle()
                    .fill(Color.green)
                    .frame(width: 6, height: 6)
                Text(session.id)
                    .font(.system(.caption, design: .monospaced))
                    .fontWeight(.medium)
                Spacer()
                Text(session.elapsedDescription)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Image(systemName: "chevron.right")
                    .imageScale(.small)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
