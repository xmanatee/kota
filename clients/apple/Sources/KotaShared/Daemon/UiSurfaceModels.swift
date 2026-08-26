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
    let payload: UiActionExecutionPayload?
}

enum UiActionExecutionPayload: Decodable, Equatable {
    case externalURL(url: String, label: String)

    private enum CodingKeys: String, CodingKey {
        case kind, url, label
    }

    private enum Kind: String, Decodable {
        case externalURL = "external-url"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .externalURL:
            self = .externalURL(
                url: try container.decode(String.self, forKey: .url),
                label: try container.decode(String.self, forKey: .label)
            )
        }
    }
}

struct UiSurfaceLiveEvent: Equatable {
    let id: String?
    let type: String
    let scopeId: String?
    let timestamp: String
    let level: UiLogLevel
    let message: String
}

struct DaemonRequestSource: Equatable {
    let connection: DaemonConnection
    let scopeId: String?
    let daemonPID: Int?
    let daemonStartedAt: String?
}

struct UiSurfaceEventSubscription: Equatable {
    let source: DaemonRequestSource
    let eventTypes: Set<String>

    var connection: DaemonConnection { source.connection }

    init?(bundle: UiSurfaceBundle, source: DaemonRequestSource) {
        var eventTypes: Set<String> = []
        for surface in bundle.surfaces {
            eventTypes.formUnion(surface.refreshEvents ?? [])
            collectUiSurfaceEventTypes(surface.nodes, into: &eventTypes)
        }
        guard !eventTypes.isEmpty else { return nil }
        self.source = source
        self.eventTypes = eventTypes
    }
}

struct UiSurfaceEventMatch: Equatable {
    let refresh: Bool
    let streamIds: [String]
}

func matchUiSurfaceEvent(
    bundle: UiSurfaceBundle,
    event: UiSurfaceLiveEvent
) -> UiSurfaceEventMatch {
    var refresh = false
    var streamIds: Set<String> = []
    for surface in bundle.surfaces where event.scopeId == nil || event.scopeId == surface.scopeId {
        if surface.refreshEvents?.contains(event.type) == true {
            refresh = true
        }
        let previousCount = streamIds.count
        collectUiSurfaceStreamIds(surface.nodes, eventType: event.type, into: &streamIds)
        if streamIds.count != previousCount {
            refresh = true
        }
    }
    return UiSurfaceEventMatch(refresh: refresh, streamIds: streamIds.sorted())
}

private func collectUiSurfaceEventTypes(_ nodes: [UiNode], into result: inout Set<String>) {
    for node in nodes {
        switch node {
        case .tabs(_, let tabs, _):
            for tab in tabs {
                collectUiSurfaceEventTypes(tab.nodes, into: &result)
            }
        case .logStream(_, let source, _, _):
            result.formUnion(source.eventTypes)
        case .navigation, .statusSummary, .metrics, .text, .link, .list,
             .table, .detail, .progress, .log, .form, .actionList, .command,
             .empty, .error:
            break
        }
    }
}

private func collectUiSurfaceStreamIds(
    _ nodes: [UiNode],
    eventType: String,
    into result: inout Set<String>
) {
    for node in nodes {
        switch node {
        case .tabs(_, let tabs, _):
            for tab in tabs {
                collectUiSurfaceStreamIds(tab.nodes, eventType: eventType, into: &result)
            }
        case .logStream(_, let source, let streamId, _):
            if source.eventTypes.contains(eventType) {
                result.insert(streamId)
            }
        case .navigation, .statusSummary, .metrics, .text, .link, .list,
             .table, .detail, .progress, .log, .form, .actionList, .command,
             .empty, .error:
            break
        }
    }
}
