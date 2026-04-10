import SwiftUI

enum ChatRole {
    case user, assistant
}

struct ChatMessage: Identifiable {
    let id: String
    let role: ChatRole
    var content: String
}

struct ChatView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss
    let sessionId: String

    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isStreaming = false
    @State private var streamingContent = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            headerView
            Divider()
            messagesView
            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
            }
            Divider()
            inputView
        }
        .frame(width: 480, height: 520)
    }

    private var headerView: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Chat")
                    .font(.headline)
                Text(sessionId)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("End Session") {
                endSession()
            }
            .foregroundStyle(.red)
            .buttonStyle(.plain)
            .font(.caption)
            .disabled(isStreaming)

            Button("Close") { dismiss() }
                .buttonStyle(.plain)
                .font(.caption)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var messagesView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(messages) { msg in
                        MessageBubble(message: msg)
                    }
                    if isStreaming {
                        MessageBubble(message: ChatMessage(
                            id: "streaming",
                            role: .assistant,
                            content: streamingContent.isEmpty ? "…" : streamingContent
                        ))
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(12)
            }
            .onChange(of: messages.count) { _ in
                withAnimation { proxy.scrollTo("bottom") }
            }
            .onChange(of: streamingContent) { _ in
                proxy.scrollTo("bottom")
            }
        }
    }

    private var inputView: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message…", text: $inputText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...5)
                .disabled(isStreaming)
                .onSubmit { sendMessage() }

            Button(action: sendMessage) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(canSend ? Color.accentColor : Color.secondary)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(12)
    }

    private var canSend: Bool {
        !inputText.trimmingCharacters(in: .whitespaces).isEmpty && !isStreaming
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !isStreaming else { return }
        inputText = ""
        errorMessage = nil
        messages.append(ChatMessage(id: UUID().uuidString, role: .user, content: text))
        isStreaming = true
        streamingContent = ""

        Task {
            do {
                try await appState.client.streamChat(sessionId: sessionId, message: text) { eventType, data in
                    guard eventType == "text" else { return }
                    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let content = obj["content"] as? String {
                        streamingContent += content
                    }
                }
                let final = streamingContent
                messages.append(ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    content: final.isEmpty ? "(no response)" : final
                ))
            } catch DaemonClientError.httpError(let code) {
                errorMessage = "HTTP \(code) — session may have expired"
            } catch DaemonClientError.notConnected {
                errorMessage = "Daemon not connected"
            } catch {
                errorMessage = error.localizedDescription
            }
            isStreaming = false
            streamingContent = ""
        }
    }

    private func endSession() {
        Task {
            await appState.endSession(sessionId)
            dismiss()
        }
    }
}

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user { Spacer(minLength: 60) }
            Text(message.content)
                .font(.system(size: 12))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(bubbleBackground)
                .foregroundStyle(message.role == .user ? Color.white : Color.primary)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .textSelection(.enabled)
            if message.role == .assistant { Spacer(minLength: 60) }
        }
    }

    private var bubbleBackground: Color {
        message.role == .user ? Color.accentColor : Color.secondary.opacity(0.15)
    }
}
