import Foundation

// Cross-store capture types and request body. Mirrors the daemon's
// `CaptureTarget` / `CaptureRecord` / `CaptureFilter` / `CaptureResult`
// exported from `src/core/server/kota-client.ts`.

/// Target store for `DaemonClient.capture`. `CaseIterable` is here so
/// the menu-bar `CaptureView` picker can list every target arm without
/// an inline literal that drifts from the wire contract.
enum CaptureTarget: String, Codable, Equatable, CaseIterable {
    case memory
    case knowledge
    case tasks
    case inbox
}

/// Discriminated mirror of the daemon's `CaptureRecord` union. Each
/// successful capture returns the typed identifier the underlying
/// store minted; the filesystem-backed contributors (tasks, inbox)
/// additionally carry the path their writer minted so a caller can
/// resolve back to the underlying store.
enum CaptureRecord: Decodable, Equatable {
    case memory(recordId: String)
    case knowledge(recordId: String)
    case tasks(recordId: String, path: String)
    case inbox(recordId: String, path: String)

    private enum CodingKeys: String, CodingKey {
        case target, recordId, path
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let target = try container.decode(CaptureTarget.self, forKey: .target)
        let recordId = try container.decode(String.self, forKey: .recordId)
        switch target {
        case .memory:
            self = .memory(recordId: recordId)
        case .knowledge:
            self = .knowledge(recordId: recordId)
        case .tasks:
            let path = try container.decode(String.self, forKey: .path)
            self = .tasks(recordId: recordId, path: path)
        case .inbox:
            let path = try container.decode(String.self, forKey: .path)
            self = .inbox(recordId: recordId, path: path)
        }
    }

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
        case .memory(let id): return id
        case .knowledge(let id): return id
        case .tasks(let id, _): return id
        case .inbox(let id, _): return id
        }
    }
}

/// Discriminated mirror of the daemon's `CaptureResult` envelope.
/// Strict decode so payload drift fails loudly instead of silently
/// degrading the rendered surface.
enum CaptureResult: Decodable, Equatable {
    case success(record: CaptureRecord)
    case ambiguous(suggestions: [CaptureTarget])
    case noContributors
    case contributorFailed(target: CaptureTarget, message: String)

    private enum CodingKeys: String, CodingKey {
        case ok, record, reason, suggestions, target, message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let record = try container.decode(CaptureRecord.self, forKey: .record)
            self = .success(record: record)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "ambiguous":
            let suggestions = try container.decode([CaptureTarget].self, forKey: .suggestions)
            self = .ambiguous(suggestions: suggestions)
        case "no_contributors":
            self = .noContributors
        case "contributor_failed":
            let target = try container.decode(CaptureTarget.self, forKey: .target)
            let message = try container.decode(String.self, forKey: .message)
            self = .contributorFailed(target: target, message: message)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown capture reason: \(reason)"
            )
        }
    }
}

/// Renders one capture record one-to-one with the shared
/// `renderCaptureRecordPlain` helper exported by
/// `src/modules/capture/render.ts`.
private func renderCaptureRecordPlain(_ record: CaptureRecord) -> String {
    switch record {
    case .memory(let id):
        return "memory  \(id)"
    case .knowledge(let id):
        return "knowledge  \(id)"
    case .tasks(let id, let path):
        return "tasks  \(id)  \(path)"
    case .inbox(let id, let path):
        return "inbox  \(id)  \(path)"
    }
}

/// Renders a `CaptureResult` one-to-one with the shared
/// `renderCaptureResultPlain` helper exported by
/// `src/modules/capture/render.ts`. The chat-surface variant
/// (`renderCaptureReplyPlain`) is Telegram-specific and intentionally
/// not mirrored here.
func renderCaptureResultPlain(_ result: CaptureResult) -> String {
    switch result {
    case .success(let record):
        return "Captured: \(renderCaptureRecordPlain(record))"
    case .ambiguous(let suggestions):
        let joined = suggestions.map { $0.rawValue }.joined(separator: ", ")
        return "Ambiguous capture. Re-run with --target <one of: \(joined)>."
    case .noContributors:
        return "Cross-store capture has no registered contributors."
    case .contributorFailed(let target, let message):
        return "Capture into \(target.rawValue) failed: \(message)"
    }
}

/// Request body shape for `POST /capture`:
/// `{ "text": <string>, "filter"?: { "target"?, "hint"? } }`. Optional
/// filter fields encode only when set so the seam applies its own
/// typed defaults.
struct CaptureRequestFilter: Encodable {
    let target: CaptureTarget?
    let hint: String?
}

struct CaptureRequestBody: Encodable {
    let text: String
    let filter: CaptureRequestFilter?
}
