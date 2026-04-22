import SwiftUI

enum ChatRole {
    case user, assistant, system, error
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
    @State private var voiceErrorCode: String?
    @State private var slashCommands: [SlashCommand] = []
    @State private var paletteDismissed = false
    @StateObject private var voiceState = VoiceState()

    var body: some View {
        VStack(spacing: 0) {
            headerView
            Divider()
            messagesView
            if let error = errorMessage {
                HStack(spacing: 4) {
                    if let code = voiceErrorCode {
                        Text("[\(code)]")
                            .font(.system(.caption, design: .monospaced))
                    }
                    Text(error)
                        .font(.caption)
                        .lineLimit(2)
                }
                .foregroundStyle(.red)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
            }
            Divider()
            inputView
        }
        .frame(width: 480, height: 520)
        .task { await loadSlashCommands() }
    }

    private var paletteQuery: String? {
        guard inputText.hasPrefix("/") else { return nil }
        let rest = inputText.dropFirst()
        if rest.contains(" ") || rest.contains("\n") { return nil }
        return String(rest)
    }

    private var filteredCommands: [SlashCommand] {
        guard let q = paletteQuery else { return [] }
        if q.isEmpty { return slashCommands }
        let lower = q.lowercased()
        return slashCommands.filter {
            $0.name.lowercased().contains(lower)
                || ($0.description ?? "").lowercased().contains(lower)
        }
    }

    private var showPalette: Bool {
        !paletteDismissed && paletteQuery != nil && !filteredCommands.isEmpty
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
        VStack(alignment: .leading, spacing: 0) {
            if showPalette {
                slashCommandPalette
                Divider()
            }
            HStack(alignment: .bottom, spacing: 8) {
                voiceButtons

                TextField("Message…", text: $inputText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                    .disabled(isStreaming)
                    .onSubmit { sendMessage() }
                    .onChange(of: inputText) { value in
                        if value.hasPrefix("/") {
                            paletteDismissed = false
                        }
                    }

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
    }

    private var voiceButtons: some View {
        HStack(spacing: 4) {
            Button(action: toggleRecording) {
                Image(systemName: voiceState.isRecording ? "stop.circle.fill" : "mic.circle")
                    .font(.title2)
                    .foregroundStyle(voiceState.isRecording ? .red : .secondary)
            }
            .buttonStyle(.plain)
            .disabled(voiceState.isUploading || voiceState.isSpeaking)
            .help(voiceState.isRecording ? "Stop recording" : "Record voice")

            Button(action: speakLatestReply) {
                Image(systemName: voiceState.isSpeaking ? "speaker.wave.2.fill" : "speaker.wave.2")
                    .font(.title2)
                    .foregroundStyle(canSpeakLatest ? .secondary : Color.secondary.opacity(0.4))
            }
            .buttonStyle(.plain)
            .disabled(!canSpeakLatest)
            .help(canSpeakLatest ? "Speak latest assistant reply" : "No reply to speak yet")
        }
    }

    private var latestAssistantText: String? {
        for message in messages.reversed() {
            if message.role == .assistant, !message.content.trimmingCharacters(in: .whitespaces).isEmpty {
                return message.content
            }
        }
        return nil
    }

    private var canSpeakLatest: Bool {
        latestAssistantText != nil
            && !voiceState.isSpeaking
            && !voiceState.isRecording
            && !voiceState.isUploading
    }

    private func toggleRecording() {
        if voiceState.isRecording {
            stopRecordingAndTranscribe()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        clearVoiceError()
        Task {
            do {
                try await voiceState.controller.startRecording()
                voiceState.isRecording = true
            } catch {
                surfaceVoiceError(code: "stt-mic-denied", message: error.localizedDescription)
            }
        }
    }

    private func stopRecordingAndTranscribe() {
        guard let captured = voiceState.controller.stopRecording() else {
            voiceState.isRecording = false
            surfaceVoiceError(code: "stt-empty-recording", message: "Recording produced no audio data.")
            return
        }
        voiceState.isRecording = false
        voiceState.isUploading = true
        Task {
            defer { voiceState.isUploading = false }
            do {
                let result = try await appState.client.voiceTranscribe(
                    audio: captured.data,
                    mimeType: captured.mimeType,
                    filename: captured.filename
                )
                switch result {
                case .success(let text, _):
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.isEmpty {
                        surfaceVoiceError(code: "stt-empty-transcript", message: "Voice provider returned no text.")
                        return
                    }
                    if inputText.trimmingCharacters(in: .whitespaces).isEmpty {
                        inputText = trimmed
                    } else {
                        inputText = "\(inputText.trimmingCharacters(in: .whitespaces)) \(trimmed)"
                    }
                case .failure(let failure):
                    surfaceVoiceError(
                        code: failure.code ?? "http-\(failure.status)",
                        message: failure.error
                    )
                }
            } catch DaemonClientError.notConnected {
                surfaceVoiceError(code: "daemon-offline", message: "Daemon not connected")
            } catch {
                surfaceVoiceError(code: "stt-request-failed", message: error.localizedDescription)
            }
        }
    }

    private func speakLatestReply() {
        guard let text = latestAssistantText else { return }
        clearVoiceError()
        voiceState.isSpeaking = true
        Task {
            defer { voiceState.isSpeaking = false }
            do {
                let result = try await appState.client.voiceSynthesize(text: text)
                switch result {
                case .success(let audio, let mimeType, _):
                    try await voiceState.controller.play(audio: audio, mimeType: mimeType)
                case .failure(let failure):
                    let suffix = failure.supportedFormats.map { " Supported: \($0.joined(separator: ", "))" } ?? ""
                    surfaceVoiceError(
                        code: failure.code ?? "http-\(failure.status)",
                        message: failure.error + suffix
                    )
                }
            } catch DaemonClientError.notConnected {
                surfaceVoiceError(code: "daemon-offline", message: "Daemon not connected")
            } catch {
                surfaceVoiceError(code: "tts-playback-failed", message: error.localizedDescription)
            }
        }
    }

    private func surfaceVoiceError(code: String, message: String) {
        voiceErrorCode = code
        errorMessage = message
    }

    private func clearVoiceError() {
        if voiceErrorCode != nil {
            voiceErrorCode = nil
            errorMessage = nil
        }
    }

    private var slashCommandPalette: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(filteredCommands) { cmd in
                    Button(action: { invokeSlashCommand(cmd) }) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(cmd.label)
                                    .font(.system(.body, design: .monospaced))
                                Spacer()
                                Text("\(cmd.source) · \(cmd.module)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            if let desc = cmd.description, !desc.isEmpty {
                                Text(desc)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
            }
        }
        .frame(maxHeight: 180)
    }

    private var canSend: Bool {
        !inputText.trimmingCharacters(in: .whitespaces).isEmpty && !isStreaming
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !isStreaming else { return }
        inputText = ""
        errorMessage = nil
        voiceErrorCode = nil
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

    private func loadSlashCommands() async {
        do {
            let resp = try await appState.client.fetchSlashCommands()
            slashCommands = resp.commands
        } catch {
            // Palette is best-effort; keep chat usable even without commands.
            slashCommands = []
        }
    }

    private func invokeSlashCommand(_ cmd: SlashCommand) {
        paletteDismissed = true
        Task {
            do {
                let result = try await appState.client.invokeSlashCommand(name: cmd.name)
                switch result {
                case .skill(let prompt):
                    inputText = prompt
                case .workflow(let queued, let runId):
                    inputText = ""
                    let runSuffix = runId.map { " (run \($0))" } ?? ""
                    messages.append(ChatMessage(
                        id: UUID().uuidString,
                        role: .system,
                        content: "Queued workflow \(queued)\(runSuffix)."
                    ))
                }
            } catch {
                errorMessage = "Failed to invoke \(cmd.label): \(error.localizedDescription)"
            }
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
                .italic(isItalic)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(bubbleBackground)
                .foregroundStyle(foregroundColor)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .textSelection(.enabled)
            if message.role != .user { Spacer(minLength: 60) }
        }
    }

    private var bubbleBackground: Color {
        switch message.role {
        case .user: return Color.accentColor
        case .assistant: return Color.secondary.opacity(0.15)
        case .system: return Color.secondary.opacity(0.08)
        case .error: return Color.red.opacity(0.15)
        }
    }

    private var foregroundColor: Color {
        switch message.role {
        case .user: return .white
        case .error: return .red
        case .system: return .secondary
        case .assistant: return .primary
        }
    }

    private var isItalic: Bool {
        message.role == .system
    }
}
