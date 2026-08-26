import Foundation

extension CaptureRecord {
    var target: CaptureTarget {
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
        case .tasks(let id, _), .inbox(let id, _): return id
        }
    }
}

private func renderCaptureRecordPlain(_ record: CaptureRecord) -> String {
    switch record {
    case .memory(let id): return "memory  \(id)"
    case .knowledge(let id): return "knowledge  \(id)"
    case .tasks(let id, let path): return "tasks  \(id)  \(path)"
    case .inbox(let id, let path): return "inbox  \(id)  \(path)"
    }
}

func renderCaptureResultPlain(_ result: CaptureResult) -> String {
    switch result {
    case .success(let record):
        return "Captured: \(renderCaptureRecordPlain(record))"
    case .ambiguous(let suggestions):
        return "Ambiguous capture. Re-run with --target <one of: \(suggestions.map(\.rawValue).joined(separator: ", "))>."
    case .noContributors:
        return "Cross-store capture has no registered contributors."
    case .contributorFailed(let target, let message):
        return "Capture into \(target.rawValue) failed: \(message)"
    }
}

struct CaptureRequestFilter: Encodable {
    let target: CaptureTarget?
    let hint: String?
}

struct CaptureRequestBody: Encodable {
    let text: String
    let filter: CaptureRequestFilter?
}
