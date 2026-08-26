import SwiftUI

struct SharedUiSurfaceEntry: Equatable {
    let surface: UiSurface
    let depth: Int
}

struct SharedUiInventory: Equatable {
    let entries: [SharedUiSurfaceEntry]
    let surfaces: [UiSurface]
    let intents: [UiIntent]

    init(bundle: UiSurfaceBundle) {
        let ordered = bundle.surfaces.sorted {
            if $0.order != $1.order { return $0.order < $1.order }
            if $0.intent != $1.intent { return $0.intent.rawValue < $1.intent.rawValue }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
        intents = ordered.reduce(into: []) { result, surface in
            if !result.contains(surface.intent) { result.append(surface.intent) }
        }
        entries = intents.flatMap { intent in
            Self.hierarchy(for: ordered.filter { $0.intent == intent })
        }
        surfaces = entries.map(\.surface)
    }

    func surfaces(for intent: UiIntent) -> [UiSurface] {
        entries(for: intent).map(\.surface)
    }

    func entries(for intent: UiIntent) -> [SharedUiSurfaceEntry] {
        entries.filter { $0.surface.intent == intent }
    }

    var entrySurface: UiSurface? {
        surfaces.first { $0.attachmentPoint == .root }
            ?? surfaces.first {
                if case .intent = $0.attachmentPoint { return true }
                return false
            }
            ?? surfaces.first
    }

    private static func hierarchy(for surfaces: [UiSurface]) -> [SharedUiSurfaceEntry] {
        let ids = Set(surfaces.map(\.surfaceId))
        var children: [String: [UiSurface]] = [:]
        var roots: [UiSurface] = []
        for surface in surfaces {
            if case .surface(let parentId) = surface.attachmentPoint, ids.contains(parentId) {
                children[parentId, default: []].append(surface)
            } else {
                roots.append(surface)
            }
        }

        var result: [SharedUiSurfaceEntry] = []
        var inserted: Set<String> = []
        func append(_ surface: UiSurface, depth: Int) {
            guard inserted.insert(surface.surfaceId).inserted else { return }
            result.append(SharedUiSurfaceEntry(surface: surface, depth: depth))
            for child in children[surface.surfaceId] ?? [] {
                append(child, depth: depth + 1)
            }
        }
        for root in roots { append(root, depth: 0) }
        for surface in surfaces { append(surface, depth: 0) }
        return result
    }
}

extension UiIntent {
    var systemImage: String {
        switch self {
        case .status: return "waveform.path.ecg"
        case .inbox: return "tray.full"
        case .work: return "briefcase"
        case .knowledge: return "books.vertical"
        case .setup: return "gearshape"
        }
    }
}

extension UiRole {
    var color: Color {
        switch self {
        case .neutral: return .primary
        case .info: return .blue
        case .success: return .green
        case .warn: return .orange
        case .error: return .red
        case .muted: return .secondary
        }
    }
}

extension UiLogLevel {
    var role: UiRole {
        switch self {
        case .debug: return .muted
        case .info: return .info
        case .warn: return .warn
        case .error: return .error
        }
    }
}

extension UiCondition {
    var label: String {
        switch self {
        case .capability(let capabilityId, let status):
            return "\(capabilityId): \(status.rawValue)"
        case .setup(let moduleName, let requirementId, let state):
            return "\(moduleName)/\(requirementId): \(state.rawValue)"
        case .scope(let scopeId):
            return "Scope \(scopeId)"
        }
    }
}

extension UiPermission {
    var label: String {
        switch self {
        case .capabilityScope(let scope): return "\(scope.rawValue) access"
        case .effect(let effect): return "\(effect.rawValue) effect"
        }
    }
}

extension UiAction {
    var operationLabel: String {
        switch operation {
        case .daemonRoute(let method, let path): return "\(method.rawValue) \(path)"
        case .clientNamespace(let method, let namespace): return "\(namespace).\(method)"
        }
    }

    var readinessMessage: String? {
        switch readiness {
        case .ready(let message): return message
        case .disabled(let message, _): return message
        case .needsSetup(let message, _, _): return message
        }
    }

    var isReady: Bool {
        if case .ready = readiness { return true }
        return false
    }
}

func referencedUiActionIds(_ nodes: [UiNode]) -> Set<String> {
    collectUiActionIds(nodes, includeActionLists: true)
}

func embeddedUiActionIds(_ nodes: [UiNode]) -> Set<String> {
    collectUiActionIds(nodes, includeActionLists: false)
}

private func collectUiActionIds(
    _ nodes: [UiNode],
    includeActionLists: Bool
) -> Set<String> {
    var result: Set<String> = []
    for node in nodes {
        switch node {
        case .tabs(_, let tabs, _):
            for tab in tabs {
                result.formUnion(collectUiActionIds(tab.nodes, includeActionLists: includeActionLists))
            }
        case .list(let items, _):
            result.formUnion(items.compactMap { $0.action?.actionId })
        case .table(_, let rows, _):
            result.formUnion(rows.compactMap { $0.action?.actionId })
        case .form(_, let submit, _), .command(let submit),
             .empty(let submit, _, _), .error(let submit, _, _):
            result.insert(submit.actionId)
        case .actionList(let actions, _):
            if includeActionLists { result.formUnion(actions.map(\.actionId)) }
        case .navigation, .statusSummary, .metrics, .text, .link, .detail,
             .progress, .log, .logStream:
            break
        }
    }
    return result
}

func rowActionDefaults(action: UiAction, rowId: String) -> [String: UiJsonValue] {
    let requiredIds = (action.parameters?.schema.required ?? []).filter {
        $0.lowercased().hasSuffix("id")
    }
    guard requiredIds.count == 1, let field = requiredIds.first else { return [:] }
    return [field: .string(rowId)]
}
