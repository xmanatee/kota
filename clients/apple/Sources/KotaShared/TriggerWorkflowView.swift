import SwiftUI

/// Workflow trigger sheet driven by the daemon's typed
/// `GET /workflow/definitions` contract. The previous version asked the
/// operator to type a free-text workflow name into a TextField — the
/// thin-client contract task replaces that with a definitions-driven
/// picker so the UI cannot trigger an unknown workflow, and so the
/// operator can see which workflows are currently disabled.
///
/// When the selected definition declares an `inputSchema`, the sheet
/// reveals a JSON payload editor. The pasted JSON is parsed locally
/// (`JSONSerialization`) so an unparseable body cannot leave the
/// client; an empty editor sends no payload at all so workflows whose
/// schema marks every field optional still trigger with one click.
/// Native JSON Schema rendering is intentionally out of scope — the
/// codebase carries no schema engine and the `manual` trigger payload
/// is forwarded verbatim by the daemon either way.
struct TriggerWorkflowView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) var dismiss
    @State private var selectedName: String?
    @State private var payloadText: String = ""
    @State private var isTriggering = false
    @State private var errorMessage: String?

    private var enabledDefinitions: [WorkflowDefinitionSummary] {
        appState.workflowDefinitions.filter { $0.enabled }
    }

    private var selectedDefinition: WorkflowDefinitionSummary? {
        guard let selectedName else { return nil }
        return appState.workflowDefinitions.first { $0.name == selectedName }
    }

    private var requiresPayload: Bool {
        selectedDefinition?.inputSchema != nil
    }

    private var payloadValidation: TriggerPayloadValidation {
        validateTriggerPayload(payloadText)
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

                if requiresPayload {
                    payloadEditor
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
        .frame(width: 360)
        .onAppear {
            if selectedName == nil {
                selectedName = enabledDefinitions.first?.name
            }
        }
    }

    @ViewBuilder
    private var payloadEditor: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Input payload (JSON object)")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextEditor(text: $payloadText)
                .font(.system(.caption, design: .monospaced))
                .frame(minHeight: 80, maxHeight: 140)
                .border(.quaternary)
            if case .invalid(let message) = payloadValidation {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.red)
            } else {
                Text("Leave empty to trigger with no input. Daemon merges this object into the manual trigger payload.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var canTrigger: Bool {
        let name = selectedName?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !name.isEmpty,
              enabledDefinitions.contains(where: { $0.name == name }) else {
            return false
        }
        if case .invalid = payloadValidation { return false }
        return true
    }

    private func trigger() {
        guard let name = selectedName, !name.isEmpty else { return }
        let validation = payloadValidation
        let payloadData: Data?
        switch validation {
        case .empty:
            payloadData = nil
        case .object(let data):
            payloadData = data
        case .invalid(let message):
            errorMessage = message
            return
        }
        isTriggering = true
        errorMessage = nil
        Task {
            do {
                try await appState.triggerWorkflow(name: name, payload: payloadData)
                dismiss()
            } catch {
                errorMessage = DaemonErrorPresenter.message(for: error)
            }
            isTriggering = false
        }
    }
}

/// Result of validating the workflow-payload editor. Pure helper so the
/// gate is unit-testable without instantiating SwiftUI views.
enum TriggerPayloadValidation: Equatable {
    case empty
    case object(Data)
    case invalid(String)
}

/// Validate the operator's pasted JSON before it leaves the client.
/// Matches the daemon's contract: only JSON objects are accepted; an
/// empty / whitespace-only editor means "no payload".
func validateTriggerPayload(_ text: String) -> TriggerPayloadValidation {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return .empty }
    guard let data = trimmed.data(using: .utf8) else {
        return .invalid("Payload could not be encoded as UTF-8.")
    }
    let parsed: Any
    do {
        parsed = try JSONSerialization.jsonObject(with: data, options: [])
    } catch {
        return .invalid("Payload is not valid JSON: \(error.localizedDescription)")
    }
    guard parsed is [String: Any] else {
        return .invalid("Payload must be a JSON object (\"{ ... }\").")
    }
    return .object(data)
}

/// One row inside the workflow picker. Rendered as a single SwiftUI
/// `Text` so the menu bar surface stays compact.
struct WorkflowPickerRow: View {
    let definition: WorkflowDefinitionSummary

    var body: some View {
        Text(label)
    }

    var label: String {
        let triggerLabel = definition.triggers.first?.label ?? ""
        let suffix = triggerLabel.isEmpty ? "" : " (\(triggerLabel))"
        let schemaSuffix = definition.inputSchema != nil ? " · input" : ""
        return "\(definition.name)\(suffix)\(schemaSuffix)"
    }
}
