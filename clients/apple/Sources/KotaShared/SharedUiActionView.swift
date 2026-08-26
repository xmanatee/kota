import Foundation
import SwiftUI

struct SharedUiActionView: View {
    @EnvironmentObject private var appState: AppState

    let action: UiAction
    let fields: [UiFormField]
    let initialParameters: [String: UiJsonValue]

    @State private var isExpanded: Bool
    @State private var textValues: [String: String]
    @State private var booleanValues: [String: Bool]
    @State private var pendingConfirmation: [String: UiJsonValue]?
    @State private var validationError: String?
    @State private var result: UiActionExecutionResult?
    @State private var isExecuting = false

    init(
        action: UiAction,
        fields: [UiFormField]? = nil,
        initialParameters: [String: UiJsonValue] = [:],
        expanded: Bool = false,
        initiallyConfirming: Bool = false
    ) {
        self.action = action
        self.fields = fields ?? action.parameters?.fields ?? []
        self.initialParameters = initialParameters
        _isExpanded = State(initialValue: expanded)
        _textValues = State(initialValue: initialTextValues(
            action: action,
            fields: fields ?? action.parameters?.fields ?? [],
            initialParameters: initialParameters
        ))
        _booleanValues = State(initialValue: initialBooleanValues(
            action: action,
            fields: fields ?? action.parameters?.fields ?? [],
            initialParameters: initialParameters
        ))
        _pendingConfirmation = State(
            initialValue: initiallyConfirming ? initialParameters : nil
        )
    }

    var body: some View {
        Group {
            if fields.isEmpty || isExpanded {
                formBody
            } else {
                DisclosureGroup(action.label, isExpanded: $isExpanded) {
                    formBody.padding(.top, 8)
                }
            }
        }
        .accessibilityIdentifier("ui-action-\(action.actionId)")
    }

    private var formBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(fields, id: \.id) { field in
                if initialParameters[field.id] == nil {
                    SharedUiFieldView(
                        field: field,
                        schema: field.schema ?? action.parameters?.schema.properties[field.id],
                        text: textBinding(field.id),
                        boolean: booleanBinding(field.id)
                    )
                }
            }

            if !(action.conditions ?? []).isEmpty || !(action.permissions ?? []).isEmpty {
                SharedUiRequirementsView(
                    conditions: action.conditions ?? [],
                    permissions: action.permissions ?? []
                )
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Button(isExecuting ? "Working…" : action.label) { submit() }
                    .buttonStyle(.borderedProminent)
                    .tint(action.effect.tint)
                    .disabled(!action.isReady || isExecuting)
                    .controlSize(.small)
                Text("\(action.operationLabel) · \(action.effect.rawValue)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            if let message = action.readinessMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(action.isReady ? Color.secondary : Color.orange)
            }

            if let pendingConfirmation,
               case .required = action.confirmation {
                SharedUiConfirmationView(
                    action: action,
                    onConfirm: { execute(pendingConfirmation) },
                    onCancel: { self.pendingConfirmation = nil }
                )
            }

            if let validationError {
                Text(validationError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityLabel("Validation error: \(validationError)")
            }
            if let result {
                Text(result.message)
                    .font(.caption)
                    .foregroundStyle(result.ok ? Color.green : Color.red)
                    .textSelection(.enabled)
                    .accessibilityIdentifier(result.ok ? "ui-action-success" : "ui-action-error")
            }
        }
    }

    private func textBinding(_ id: String) -> Binding<String> {
        Binding(
            get: { textValues[id] ?? "" },
            set: { textValues[id] = $0 }
        )
    }

    private func booleanBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { booleanValues[id] ?? false },
            set: { booleanValues[id] = $0 }
        )
    }

    private func submit() {
        do {
            let parameters = try readUiParameters(
                action: action,
                fields: fields,
                textValues: textValues,
                booleanValues: booleanValues,
                initialParameters: initialParameters
            )
            validationError = nil
            result = nil
            switch action.confirmation {
            case .none:
                execute(parameters)
            case .required:
                pendingConfirmation = parameters
            }
        } catch {
            validationError = error.localizedDescription
        }
    }

    private func execute(_ parameters: [String: UiJsonValue]) {
        pendingConfirmation = nil
        isExecuting = true
        Task {
            result = await appState.executeUiAction(
                action,
                parameters: parameters.isEmpty ? nil : parameters
            )
            isExecuting = false
        }
    }
}

struct SharedUiConfirmationView: View {
    let action: UiAction
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        if case .required(let confirmLabel, let detail, let risk, let title) = action.confirmation {
            VStack(alignment: .leading, spacing: 8) {
                Label(title, systemImage: "exclamationmark.shield")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(risk.tint)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Button(confirmLabel, action: onConfirm)
                        .buttonStyle(.borderedProminent)
                        .tint(risk.tint)
                    Button("Cancel", action: onCancel)
                        .buttonStyle(.bordered)
                }
                .controlSize(.small)
            }
            .padding(10)
            .background(risk.tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(risk.tint.opacity(0.35)))
            .accessibilityIdentifier("ui-confirmation-\(action.actionId)")
        }
    }
}

struct SharedUiRequirementsView: View {
    let conditions: [UiCondition]
    let permissions: [UiPermission]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 5) {
                ForEach(Array(conditions.enumerated()), id: \.offset) { _, condition in
                    requirement(condition.label, filled: true)
                }
                ForEach(Array(permissions.enumerated()), id: \.offset) { _, permission in
                    requirement(permission.label, filled: false)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Action requirements")
    }

    private func requirement(_ label: String, filled: Bool) -> some View {
        Text(label)
            .font(.caption2)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(filled ? Color.secondary.opacity(0.12) : Color.clear)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color.secondary.opacity(0.25)))
    }
}

private extension UiActionEffect {
    var tint: Color {
        switch self {
        case .read: return .secondary
        case .write: return .accentColor
        case .external: return .purple
        }
    }
}

private extension UiConfirmationRisk {
    var tint: Color {
        switch self {
        case .low: return .blue
        case .medium: return .orange
        case .high: return .red
        }
    }
}
