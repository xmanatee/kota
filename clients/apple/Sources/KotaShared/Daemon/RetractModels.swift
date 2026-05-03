import Foundation

// Cross-store retract types and request shape. Mirrors the daemon's
// `RetractTarget` / `RetractRequest` / `RetractRecord` /
// `RetractResult` exported from `src/core/server/kota-client.ts`.

/// Target store for `DaemonClient.retract`. `CaseIterable` is here so
/// any future menu-bar `RetractView` picker can list every target arm
/// without an inline literal that drifts from the wire contract.
enum RetractTarget: String, Codable, Equatable, CaseIterable {
    case memory
    case knowledge
    case tasks
    case inbox
}

/// Discriminated mirror of the daemon's `RetractRequest` union. Each
/// arm carries the per-target identifier the contributor expects —
/// `id` for memory and tasks, `slug` for knowledge, `path` for inbox
/// — so the type system rejects passing an inbox `path` alongside a
/// memory `id` at compile time. Encoded as the wire shape
/// `{ "target": <string>, ...identifier }` without nullable identifier
/// fields.
enum RetractRequest: Encodable, Equatable {
    case memory(id: String)
    case knowledge(slug: String)
    case tasks(id: String)
    case inbox(path: String)

    private enum CodingKeys: String, CodingKey {
        case target, id, slug, path
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .memory(let id):
            try container.encode("memory", forKey: .target)
            try container.encode(id, forKey: .id)
        case .knowledge(let slug):
            try container.encode("knowledge", forKey: .target)
            try container.encode(slug, forKey: .slug)
        case .tasks(let id):
            try container.encode("tasks", forKey: .target)
            try container.encode(id, forKey: .id)
        case .inbox(let path):
            try container.encode("inbox", forKey: .target)
            try container.encode(path, forKey: .path)
        }
    }
}

/// Discriminated mirror of the daemon's `RetractRecord` union. Each
/// successful retract returns the typed identifier the underlying
/// contributor removed; the tasks arm additionally carries
/// `previousPath`, `path`, and the explicit destination state so an
/// operator surface can render "moved to dropped", not "deleted", and
/// the inbox arm carries the deleted file path.
enum RetractRecord: Decodable, Equatable {
    case memory(recordId: String)
    case knowledge(recordId: String)
    case tasks(recordId: String, previousPath: String, path: String, toState: String)
    case inbox(recordId: String, path: String)

    private enum CodingKeys: String, CodingKey {
        case target, recordId, previousPath, path, toState
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let target = try container.decode(RetractTarget.self, forKey: .target)
        let recordId = try container.decode(String.self, forKey: .recordId)
        switch target {
        case .memory:
            self = .memory(recordId: recordId)
        case .knowledge:
            self = .knowledge(recordId: recordId)
        case .tasks:
            let previousPath = try container.decode(String.self, forKey: .previousPath)
            let path = try container.decode(String.self, forKey: .path)
            let toState = try container.decode(String.self, forKey: .toState)
            self = .tasks(recordId: recordId, previousPath: previousPath, path: path, toState: toState)
        case .inbox:
            let path = try container.decode(String.self, forKey: .path)
            self = .inbox(recordId: recordId, path: path)
        }
    }

    var target: RetractTarget {
        switch self {
        case .memory: return .memory
        case .knowledge: return .knowledge
        case .tasks: return .tasks
        case .inbox: return .inbox
        }
    }

    var recordId: String {
        switch self {
        case .memory(let id): return id
        case .knowledge(let id): return id
        case .tasks(let id, _, _, _): return id
        case .inbox(let id, _): return id
        }
    }
}

/// Discriminated mirror of the daemon's `RetractResult` envelope.
/// Strict decode so payload drift fails loudly instead of silently
/// degrading the rendered surface.
enum RetractResult: Decodable, Equatable {
    case success(record: RetractRecord)
    case noContributors
    case notFound(target: RetractTarget, identifier: String)
    case contributorFailed(target: RetractTarget, message: String)

    private enum CodingKeys: String, CodingKey {
        case ok, record, reason, target, identifier, message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let record = try container.decode(RetractRecord.self, forKey: .record)
            self = .success(record: record)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "no_contributors":
            self = .noContributors
        case "not_found":
            let target = try container.decode(RetractTarget.self, forKey: .target)
            let identifier = try container.decode(String.self, forKey: .identifier)
            self = .notFound(target: target, identifier: identifier)
        case "contributor_failed":
            let target = try container.decode(RetractTarget.self, forKey: .target)
            let message = try container.decode(String.self, forKey: .message)
            self = .contributorFailed(target: target, message: message)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown retract reason: \(reason)"
            )
        }
    }
}

/// Renders one retract record one-to-one with the shared
/// `renderRetractRecordPlain` helper exported by
/// `src/modules/retract/render.ts`.
private func renderRetractRecordPlain(_ record: RetractRecord) -> String {
    switch record {
    case .memory(let id):
        return "memory  \(id)"
    case .knowledge(let id):
        return "knowledge  \(id)"
    case .tasks(let id, let previousPath, let path, let toState):
        return "tasks  \(id)  \(previousPath) -> \(path) (\(toState))"
    case .inbox(let id, let path):
        return "inbox  \(id)  \(path)"
    }
}

/// Renders a `RetractResult` one-to-one with the shared
/// `renderRetractResultPlain` helper exported by
/// `src/modules/retract/render.ts`.
func renderRetractResultPlain(_ result: RetractResult) -> String {
    switch result {
    case .success(let record):
        return "Retracted: \(renderRetractRecordPlain(record))"
    case .noContributors:
        return "Cross-store retract has no registered contributors for the named target."
    case .notFound(let target, let identifier):
        return "Retract \(target.rawValue): no record with identifier \"\(identifier)\"."
    case .contributorFailed(let target, let message):
        return "Retract from \(target.rawValue) failed: \(message)"
    }
}
