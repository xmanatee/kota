import SwiftUI

struct OwnerQuestionsView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        if appState.pendingOwnerQuestions.isEmpty { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 0) {
                Divider()
                Text("Owner Questions")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 4)

                ForEach(appState.pendingOwnerQuestions) { question in
                    OwnerQuestionRow(question: question)
                }
            }
        )
    }
}

struct OwnerQuestionRow: View {
    @EnvironmentObject var appState: AppState
    let question: OwnerQuestion
    @State private var answerText: String = ""
    @State private var isProcessing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "questionmark.circle.fill")
                    .imageScale(.small)
                    .foregroundStyle(.blue)
                Text(question.source)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Text(question.question)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            if !question.reason.isEmpty {
                Text(question.reason)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            if let proposed = question.proposedAnswers, !proposed.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(proposed, id: \.self) { suggestion in
                        Button(action: {
                            answerText = suggestion
                            submitAnswer()
                        }) {
                            Text(suggestion)
                                .font(.caption2)
                                .lineLimit(1)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.15))
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                        }
                        .buttonStyle(.plain)
                        .disabled(isProcessing)
                    }
                }
            }

            TextField("Your answer…", text: $answerText)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .disabled(isProcessing)
                .onSubmit { submitAnswer() }

            HStack(spacing: 8) {
                Button("Answer") { submitAnswer() }
                    .buttonStyle(.borderedProminent)
                    .tint(.blue)
                    .disabled(isProcessing || answerText.trimmingCharacters(in: .whitespaces).isEmpty)

                Button("Dismiss") {
                    isProcessing = true
                    Task {
                        await appState.dismissOwnerQuestion(id: question.id)
                        isProcessing = false
                    }
                }
                .buttonStyle(.bordered)
                .tint(.secondary)
                .disabled(isProcessing)

                if isProcessing {
                    ProgressView().scaleEffect(0.6)
                }
            }
            .font(.caption)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)

        Divider().padding(.leading, 12)
    }

    private func submitAnswer() {
        let trimmed = answerText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        isProcessing = true
        Task {
            await appState.answerOwnerQuestion(id: question.id, answer: trimmed)
            answerText = ""
            isProcessing = false
        }
    }
}
