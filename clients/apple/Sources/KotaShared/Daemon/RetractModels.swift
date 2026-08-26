import Foundation

enum RetractRequest: Encodable, Equatable {
    case memory(id: String)
    case knowledge(slug: String)
    case tasks(id: String)
    case inbox(path: String)

    private enum CodingKeys: String, CodingKey { case target, id, slug, path }

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

extension RetractRecord {
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
        case .memory(let id), .knowledge(let id): return id
        case .tasks(let id, _, _), .inbox(let id, _): return id
        }
    }
}

private func renderRetractRecordPlain(_ record: RetractRecord) -> String {
    switch record {
    case .memory(let id): return "memory  \(id)"
    case .knowledge(let id): return "knowledge  \(id)"
    case .tasks(let id, let previousPath, let path):
        return "tasks  \(id)  \(previousPath) -> \(path) (dropped)"
    case .inbox(let id, let path): return "inbox  \(id)  \(path)"
    }
}

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
