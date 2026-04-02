import Foundation

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
    let paused: Bool?
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

// MARK: - Approvals

struct ApprovalsResponse: Codable {
    let approvals: [ApprovalRequest]
}

struct ApprovalRequest: Codable, Identifiable {
    let id: String
    let tool: String
    let risk: String
    let reason: String?
    let createdAt: String
    let status: String

    // input is arbitrary JSON — skip decoding
    enum CodingKeys: String, CodingKey {
        case id, tool, risk, reason, createdAt, status
    }

    var riskColor: String {
        switch risk {
        case "dangerous": return "red"
        case "elevated": return "orange"
        default: return "yellow"
        }
    }
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

// MARK: - Trigger

struct TriggerRequest: Codable {
    let workflow: String
}

struct TriggerResponse: Codable {
    let runId: String?
}

// MARK: - Task queue

struct TaskQueueResponse: Codable {
    let counts: TaskQueueCounts
    let tasks: TaskQueueTasks
}

struct TaskQueueCounts: Codable {
    let inbox: Int
    let ready: Int
    let backlog: Int
    let doing: Int
    let blocked: Int
}

struct TaskQueueTasks: Codable {
    let doing: [TaskDetail]
    let ready: [TaskDetail]
}

struct TaskDetail: Codable, Identifiable {
    let id: String
    let title: String
    let priority: String
    let area: String
    let summary: String
}

// MARK: - Daemon connectivity state

enum DaemonHealth {
    case unknown
    case offline
    case idle
    case running(Int)  // active run count
    case error(String)

    var systemImageName: String {
        switch self {
        case .unknown: return "circle"
        case .offline: return "circle.slash"
        case .idle: return "checkmark.circle.fill"
        case .running: return "arrow.2.circlepath.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        }
    }

    var label: String {
        switch self {
        case .unknown: return "KOTA"
        case .offline: return "Daemon offline"
        case .idle: return "Idle"
        case .running(let n): return n == 1 ? "1 run active" : "\(n) runs active"
        case .error(let msg): return "Error: \(msg)"
        }
    }
}
