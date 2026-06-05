import Foundation

// Daemon discovery, status, and run-detail Codable mirrors. Mirrors the
// shapes the daemon control API exposes for general lifecycle
// (`/health`, `/status`, `/workflow/runs`).

// MARK: - Daemon discovery

struct DaemonControlFile: Codable {
    let port: Int
    let pid: Int
    let startedAt: String
    let token: String
}

// MARK: - Status

struct DaemonStatusResponse: Codable {
    let running: Bool
    let workflow: WorkflowStatusPayload?
}

struct WorkflowStatusPayload: Codable {
    let activeRuns: [ActiveRun]
    let pendingRuns: [PendingRun]?
    let queueLength: Int?
    let paused: Bool?

    var queuedRunCount: Int {
        queueLength ?? pendingRuns?.count ?? 0
    }
}

struct ActiveRun: Codable, Identifiable {
    let runId: String
    let workflow: String
    let startedAt: String

    var id: String { runId }

    var elapsedDescription: String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: startedAt) else { return "" }
        let seconds = Int(-date.timeIntervalSinceNow)
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return "\(h)h \(m)m"
    }
}

struct PendingRun: Codable, Identifiable {
    let runId: String?
    let workflowName: String

    var id: String { runId ?? workflowName }
}

struct WorkflowControlResponse: Codable {
    let ok: Bool?
    let paused: Bool?
    let already: Bool?
}

// MARK: - Run detail

struct RunStepSummary: Codable {
    let id: String
    let type: String
    let status: String
    let durationMs: Double
    let error: String?
    let costUsd: Double?
}

struct RunDetail: Codable {
    let id: String
    let workflow: String
    let status: String
    let startedAt: String
    let steps: [RunStepSummary]

    var currentStep: RunStepSummary? {
        steps.first(where: { $0.status == "running" }) ?? steps.last
    }
}

// MARK: - Run history

struct RunHistoryResponse: Codable {
    let runs: [RunSummary]
}

struct RunSummary: Codable, Identifiable {
    let id: String
    let workflow: String
    let status: String
    let startedAt: String
    let durationMs: Double?

    var durationDescription: String {
        guard let ms = durationMs, ms > 0 else { return "" }
        let s = Int(ms / 1000)
        if s < 60 { return "\(s)s" }
        let m = s / 60
        let rem = s % 60
        return rem == 0 ? "\(m)m" : "\(m)m \(rem)s"
    }

    var statusIcon: String {
        switch status {
        case "success": return "checkmark.circle.fill"
        case "failed": return "xmark.circle.fill"
        case "interrupted": return "slash.circle.fill"
        case "completed-with-warnings": return "exclamationmark.circle.fill"
        default: return "circle"
        }
    }

    var statusColor: String {
        switch status {
        case "success": return "green"
        case "failed": return "red"
        case "interrupted": return "orange"
        case "completed-with-warnings": return "yellow"
        default: return "secondary"
        }
    }
}

// MARK: - Daemon connectivity state

enum DaemonHealth {
    case unknown
    case offline
    case idle
    case running(Int)  // active run count
    case paused(Int)  // queued run count
    case error(String)

    var systemImageName: String {
        switch self {
        case .unknown: return "circle"
        case .offline: return "circle.slash"
        case .idle: return "checkmark.circle.fill"
        case .running: return "arrow.2.circlepath.circle.fill"
        case .paused: return "pause.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        }
    }

    var label: String {
        switch self {
        case .unknown: return "KOTA"
        case .offline: return "Daemon offline"
        case .idle: return "Idle"
        case .running(let n): return n == 1 ? "1 run active" : "\(n) runs active"
        case .paused(let n): return n == 1 ? "Dispatch paused · 1 queued" : "Dispatch paused · \(n) queued"
        case .error(let msg): return "Error: \(msg)"
        }
    }

    var isDispatchPaused: Bool {
        if case .paused = self { return true }
        return false
    }
}
