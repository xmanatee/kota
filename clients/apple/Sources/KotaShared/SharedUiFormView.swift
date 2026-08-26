import Foundation
import SwiftUI

struct SharedUiFieldView: View {
    @EnvironmentObject private var appState: AppState
    let field: UiFormField
    let schema: UiJsonSchema?
    @Binding var text: String
    @Binding var boolean: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            switch field.input {
            case .boolean:
                Toggle(field.label, isOn: $boolean)
            case .multiline:
                TextField(field.label, text: $text, axis: .vertical)
                    .lineLimit(3...8)
                    .textFieldStyle(.roundedBorder)
            case .secret:
                SecureField(field.label, text: $text)
                    .textFieldStyle(.roundedBorder)
            case .select:
                Picker(field.label, selection: $text) {
                    ForEach(options, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                .pickerStyle(.menu)
            case .path:
                HStack {
                    TextField(field.label, text: $text).textFieldStyle(.roundedBorder)
                    if appState.platform.supportsNativeProjectPicker {
                        Button("Choose…") {
                            Task {
                                if let selected = await appState.pickUiPath() { text = selected.path }
                            }
                        }
                    }
                }
            case .text, .number, .url:
                TextField(field.label, text: $text).textFieldStyle(.roundedBorder)
            }
            if let detail = schema?.descriptionText {
                Text(detail).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("ui-field-\(field.id)")
    }

    private var options: [UiFieldOption] {
        if let options = field.options, !options.isEmpty { return options }
        if case .string(_, _, let values, _, _) = schema {
            return (values ?? []).map { UiFieldOption(label: $0, value: $0) }
        }
        return []
    }
}

private enum UiFormValidationError: LocalizedError {
    case required(String)
    case invalidNumber(String)
    case invalidInteger(String)
    case belowMinimum(String, Double)
    case aboveMaximum(String, Double)
    case invalidURL(String)
    case invalidJSON(String)

    var errorDescription: String? {
        switch self {
        case .required(let label): return "\(label) is required."
        case .invalidNumber(let label): return "\(label) must be a number."
        case .invalidInteger(let label): return "\(label) must be a whole number."
        case .belowMinimum(let label, let value): return "\(label) must be at least \(value)."
        case .aboveMaximum(let label, let value): return "\(label) must be at most \(value)."
        case .invalidURL(let label): return "\(label) must be an absolute URL."
        case .invalidJSON(let label): return "\(label) must contain valid JSON."
        }
    }
}

func readUiParameters(
    action: UiAction,
    fields: [UiFormField],
    textValues: [String: String],
    booleanValues: [String: Bool],
    initialParameters: [String: UiJsonValue]
) throws -> [String: UiJsonValue] {
    var result = initialParameters
    for field in fields where initialParameters[field.id] == nil {
        let schema = field.schema ?? action.parameters?.schema.properties[field.id]
        if field.input == .boolean {
            result[field.id] = .boolean(booleanValues[field.id] ?? schema?.booleanDefault ?? false)
            continue
        }
        let raw = (textValues[field.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty {
            if field.required { throw UiFormValidationError.required(field.label) }
            continue
        }
        result[field.id] = try uiJsonValue(raw: raw, field: field, schema: schema)
    }
    return result
}

private func uiJsonValue(raw: String, field: UiFormField, schema: UiJsonSchema?) throws -> UiJsonValue {
    switch schema {
    case .number(_, _, let maximum, let minimum, _):
        guard let value = Double(raw) else { throw UiFormValidationError.invalidNumber(field.label) }
        try validateBounds(value, label: field.label, minimum: minimum, maximum: maximum)
        return .number(value)
    case .integer(_, _, let maximum, let minimum, _):
        guard let value = Double(raw), value.rounded() == value else {
            throw UiFormValidationError.invalidInteger(field.label)
        }
        try validateBounds(value, label: field.label, minimum: minimum, maximum: maximum)
        return .number(value)
    case .boolean:
        return .boolean(raw == "true")
    case .array, .object:
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let value = uiJsonValue(any: object)
        else { throw UiFormValidationError.invalidJSON(field.label) }
        return value
    case .string(_, _, _, let format, _):
        if format == .url, (URL(string: raw)?.scheme ?? "").isEmpty {
            throw UiFormValidationError.invalidURL(field.label)
        }
        return .string(raw)
    case nil:
        if field.input == .number {
            guard let value = Double(raw) else { throw UiFormValidationError.invalidNumber(field.label) }
            return .number(value)
        }
        if field.input == .url, (URL(string: raw)?.scheme ?? "").isEmpty {
            throw UiFormValidationError.invalidURL(field.label)
        }
        return .string(raw)
    }
}

private func validateBounds(_ value: Double, label: String, minimum: Double?, maximum: Double?) throws {
    if let minimum, value < minimum { throw UiFormValidationError.belowMinimum(label, minimum) }
    if let maximum, value > maximum { throw UiFormValidationError.aboveMaximum(label, maximum) }
}

private func uiJsonValue(any: Any) -> UiJsonValue? {
    switch any {
    case let value as String: return .string(value)
    case let value as Bool: return .boolean(value)
    case let value as NSNumber: return .number(value.doubleValue)
    case let value as [Any]:
        let values = value.compactMap(uiJsonValue(any:))
        return values.count == value.count ? .array(values) : nil
    case let value as [String: Any]:
        var object: [String: UiJsonValue] = [:]
        for (key, child) in value {
            guard let converted = uiJsonValue(any: child) else { return nil }
            object[key] = converted
        }
        return .object(object)
    case is NSNull: return .null
    default: return nil
    }
}

func initialTextValues(
    action: UiAction,
    fields: [UiFormField],
    initialParameters: [String: UiJsonValue]
) -> [String: String] {
    Dictionary(uniqueKeysWithValues: fields.compactMap { field in
        if case .string(let value) = initialParameters[field.id] { return (field.id, value) }
        if case .number(let value) = initialParameters[field.id] { return (field.id, String(value)) }
        let schema = field.schema ?? action.parameters?.schema.properties[field.id]
        return schema?.textDefault.map { (field.id, $0) }
    })
}

func initialBooleanValues(
    action: UiAction,
    fields: [UiFormField],
    initialParameters: [String: UiJsonValue]
) -> [String: Bool] {
    Dictionary(uniqueKeysWithValues: fields.compactMap { field in
        if case .boolean(let value) = initialParameters[field.id] { return (field.id, value) }
        let schema = field.schema ?? action.parameters?.schema.properties[field.id]
        return schema?.booleanDefault.map { (field.id, $0) }
    })
}

private extension UiJsonSchema {
    var descriptionText: String? {
        switch self {
        case .string(_, let description, _, _, _),
             .number(_, let description, _, _, _),
             .integer(_, let description, _, _, _),
             .boolean(_, let description, _),
             .array(let description, _, _),
             .object(_, let description, _, _, _):
            return description
        }
    }

    var textDefault: String? {
        switch self {
        case .string(let value, _, _, _, _): return value
        case .number(let value, _, _, _, _), .integer(let value, _, _, _, _):
            return value.map { String($0) }
        case .boolean, .array, .object: return nil
        }
    }

    var booleanDefault: Bool? {
        if case .boolean(let value, _, _) = self { return value }
        return nil
    }
}
