import Foundation

/// JSON values submitted to daemon-owned `ui.surface.v1` actions. Keeping the
/// recursive wire value typed prevents view code from constructing route- or
/// capability-specific request bodies.
indirect enum UiJsonValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case boolean(Bool)
    case array([UiJsonValue])
    case object([String: UiJsonValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([UiJsonValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: UiJsonValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .boolean(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

struct UiActionExecuteRequest: Encodable, Equatable {
    let surfaceId: String
    let actionId: String
    let scopeId: String
    let parameters: [String: UiJsonValue]?
}

struct UiActionExecutionResult: Decodable, Equatable {
    let ok: Bool
    let reason: String?
    let message: String
}

struct UiSurfaceLiveEvent: Equatable {
    let type: String
    let timestamp: String
    let level: UiLogLevel
    let message: String
}
