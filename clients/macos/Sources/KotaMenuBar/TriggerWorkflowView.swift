import SwiftUI

/// Workflow trigger sheet driven by the daemon's typed
/// `GET /workflow/definitions` contract. The previous version asked the
/// operator to type a free-text workflow name into a TextField — the
/// thin-client contract task replaces that with a definitions-driven
/// picker so the UI cannot trigger an unknown workflow, and so the
/// operator can see which workflows are currently disabled or carry an
/// input schema that the macOS surface does not yet render.
struct TriggerWorkflowView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss
    @State private var selectedName: String?
    @State private var isTriggering = false
    @State private var errorMessage: String?

    private var enabledDefinitions: [WorkflowDefinitionSummary] {
        appState.workflowDefinitions.filter { $0.enabled }
    }

    private var selectedDefinition: WorkflowDefinitionSummary? {
        guard let selectedName else { return nil }
        return appState.workflowDefinitions.first { $0.name == selectedName }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Trigger Workflow")
                .font(.headline)

            if appState.workflowDefinitions.isEmpty {
                Text("Daemon has no workflow definitions loaded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if enabledDefinitions.isEmpty {
                Text("All workflow definitions are disabled.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                Picker("Workflow", selection: Binding(
                    get: { selectedName ?? enabledDefinitions.first?.name ?? "" },
                    set: { selectedName = $0 }
                )) {
                    ForEach(enabledDefinitions) { def in
                        WorkflowPickerRow(definition: def).tag(def.name)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)

                if let definition = selectedDefinition,
                   definition.inputSchema != nil {
                    Text("This workflow declares an input schema. The macOS surface triggers it without input — provide input via the daemon control API or CLI for now.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

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
                    .disabled(canTrigger == false || isTriggering)
                    .keyboardShortcut(.return, modifiers: [])
            }
        }
        .padding(16)
        .frame(width: 320)
        .onAppear {
            if selectedName == nil {
                selectedName = enabledDefinitions.first?.name
            }
        }
    }

    private var canTrigger: Bool {
        let name = selectedName?.trimmingCharacters(in: .whitespaces) ?? ""
        return !name.isEmpty && enabledDefinitions.contains(where: { $0.name == name })
    }

    private func trigger() {
        guard let name = selectedName, !name.isEmpty else { return }
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

/// One row inside the workflow picker. Rendered as a single SwiftUI
/// `Text` so the menu bar surface stays compact.
private struct WorkflowPickerRow: View {
    let definition: WorkflowDefinitionSummary

    var body: some View {
        Text(label)
    }

    private var label: String {
        let triggerLabel = definition.triggers.first?.label ?? ""
        let suffix = triggerLabel.isEmpty ? "" : " (\(triggerLabel))"
        return "\(definition.name)\(suffix)"
    }
}
