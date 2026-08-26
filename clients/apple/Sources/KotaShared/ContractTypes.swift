import Foundation

// Workflow definitions are not part of the thin-client route set yet. Shared
// daemon wire types live in Generated/DaemonContract.generated.swift.

extension ClientDashboardAvailability {
    var isAvailable: Bool {
        if case .available = self { return true }
        return false
    }
}

enum WorkflowDefinitionTriggerSummary: Codable, Equatable {
    case event(event: String)
    case cron(schedule: String)
    case interval(intervalMs: Int)
    case webhook
    case watch(patterns: [String], debounceMs: Int)

    private enum CodingKeys: String, CodingKey {
        case type, event, schedule, intervalMs, patterns, debounceMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "event": self = .event(event: try container.decode(String.self, forKey: .event))
        case "cron": self = .cron(schedule: try container.decode(String.self, forKey: .schedule))
        case "interval": self = .interval(intervalMs: try container.decode(Int.self, forKey: .intervalMs))
        case "webhook": self = .webhook
        case "watch":
            self = .watch(
                patterns: try container.decode([String].self, forKey: .patterns),
                debounceMs: try container.decode(Int.self, forKey: .debounceMs)
            )
        case let value:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unknown workflow trigger type: \(value)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .event(let event):
            try container.encode("event", forKey: .type)
            try container.encode(event, forKey: .event)
        case .cron(let schedule):
            try container.encode("cron", forKey: .type)
            try container.encode(schedule, forKey: .schedule)
        case .interval(let intervalMs):
            try container.encode("interval", forKey: .type)
            try container.encode(intervalMs, forKey: .intervalMs)
        case .webhook:
            try container.encode("webhook", forKey: .type)
        case .watch(let patterns, let debounceMs):
            try container.encode("watch", forKey: .type)
            try container.encode(patterns, forKey: .patterns)
            try container.encode(debounceMs, forKey: .debounceMs)
        }
    }

    var label: String {
        switch self {
        case .event(let event): return "event:\(event)"
        case .cron(let schedule): return "cron:\(schedule)"
        case .interval(let milliseconds):
            let seconds = milliseconds / 1000
            return seconds > 0 ? "interval:\(seconds)s" : "interval:\(milliseconds)ms"
        case .webhook: return "webhook"
        case .watch(let patterns, _): return "watch:\(patterns.first ?? "")"
        }
    }
}

struct WorkflowDefinitionSummary: Codable, Equatable, Identifiable {
    let name: String
    let enabled: Bool
    let runtimeEnabled: Bool?
    let stepCount: Int
    let triggers: [WorkflowDefinitionTriggerSummary]
    let inputSchema: WorkflowInputSchema?
    var id: String { name }
}

struct WorkflowInputSchema: Codable, Equatable {
    let raw: Data

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        raw = try JSONEncoder().encode(container.decode(JSONValue.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(JSONDecoder().decode(JSONValue.self, from: raw))
    }
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode([JSONValue].self) { self = .array(value); return }
        if let value = try? container.decode([String: JSONValue].self) { self = .object(value); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

struct WorkflowDefinitionsResponse: Codable, Equatable {
    let definitions: [WorkflowDefinitionSummary]
}
