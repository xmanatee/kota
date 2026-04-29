import SwiftUI

struct TriggerWorkflowView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss
    @State private var workflowName = ""
    @State private var isTriggering = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Trigger Workflow")
                .font(.headline)

            TextField("Workflow name (e.g. builder)", text: $workflowName)
                .textFieldStyle(.roundedBorder)
                .onSubmit { trigger() }

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.escape, modifiers: [])

                Button("Trigger") { trigger() }
                    .buttonStyle(.borderedProminent)
                    .disabled(workflowName.trimmingCharacters(in: .whitespaces).isEmpty || isTriggering)
                    .keyboardShortcut(.return, modifiers: [])
            }
        }
        .padding(16)
        .frame(width: 300)
    }

    private func trigger() {
        let name = workflowName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        isTriggering = true
        errorMessage = nil
        Task {
            do {
                try await appState.triggerWorkflow(name: name)
                dismiss()
            } catch {
                errorMessage = DaemonErrorPresenter.message(for: error)
            }
            isTriggering = false
        }
    }
}
