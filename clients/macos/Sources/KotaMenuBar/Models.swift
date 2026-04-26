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

// MARK: - Owner questions

struct OwnerQuestionsResponse: Codable {
    let questions: [OwnerQuestion]
}

struct OwnerQuestion: Codable, Identifiable {
    let id: String
    let context: String
    let question: String
    let reason: String
    let source: String
    let createdAt: String
    let status: String
    let proposedAnswers: [String]?
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

// MARK: - Autonomy mode

enum AutonomyMode: String, Codable, CaseIterable, Identifiable {
    case passive
    case supervised
    case autonomous

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

// MARK: - Chat session creation

struct CreateSessionResponse: Codable {
    let session_id: String
    let autonomy_mode: AutonomyMode?
}

struct CreateSessionRequest: Codable {
    let autonomy_mode: AutonomyMode?
}

struct SetAutonomyModeRequest: Codable {
    let autonomy_mode: AutonomyMode
}

struct SetAutonomyModeResponse: Codable {
    let session_id: String
    let autonomy_mode: AutonomyMode
    let source: String?
    let serveOwned: Bool?
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

// MARK: - Sessions

struct SessionsResponse: Codable {
    let sessions: [SessionSummary]
}

struct SessionSummary: Codable, Identifiable {
    let id: String
    let createdAt: String
    let lastActive: Double
    let autonomyMode: AutonomyMode
    let source: String?

    var elapsedDescription: String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: createdAt) else { return "" }
        let seconds = Int(-date.timeIntervalSinceNow)
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return "\(h)h \(m)m"
    }
}

// MARK: - Slash commands

struct SlashCommandsResponse: Codable {
    let commands: [SlashCommand]
}

struct SlashCommand: Codable, Identifiable {
    let name: String
    let label: String
    let description: String?
    let source: String
    let module: String

    var id: String { name }
}

struct InvokeCommandRequest: Codable {
    let name: String
}

enum InvokeCommandResponse: Decodable {
    case workflow(queued: String, runId: String?)
    case skill(prompt: String)

    enum CodingKeys: String, CodingKey {
        case kind, queued, runId, prompt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "workflow":
            let queued = try container.decode(String.self, forKey: .queued)
            let runId = try container.decodeIfPresent(String.self, forKey: .runId)
            self = .workflow(queued: queued, runId: runId)
        case "skill":
            let prompt = try container.decode(String.self, forKey: .prompt)
            self = .skill(prompt: prompt)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "Unknown command action kind: \(kind)"
            )
        }
    }
}

// MARK: - Voice

/// Failure shape for the daemon's voice endpoints. Mirrors the typed codes
/// the voice module documents (`stt-unavailable`, `tts-unavailable`,
/// `tts-format-unsupported`, `stt-failed`, `tts-failed`).
struct VoiceFailure {
    let status: Int
    let error: String
    let code: String?
    let supportedFormats: [String]?
}

enum VoiceTranscribeResult {
    case success(text: String, language: String?)
    case failure(VoiceFailure)
}

enum VoiceSynthesizeResult {
    case success(audio: Data, mimeType: String, format: String)
    case failure(VoiceFailure)
}

// MARK: - Digest

/// Mirror of `DailyDigestData` exported by the daemon's
/// `src/modules/autonomy/workflows/daily-digest/aggregate.ts`. Decoding is
/// strict against the daemon's contract so a payload drift fails loudly at
/// `JSONDecoder` rather than silently rendering an empty section.
struct DigestResponse: Codable {
    let data: DailyDigestData
    let text: String
}

struct DailyDigestData: Codable {
    let windowStartedAt: String
    let windowEndedAt: String
    let builderCommits: [DigestBuilderCommitItem]
    let explorerAdditions: [DigestExplorerAdditionItem]
    let decomposerSplits: [DigestDecomposerSplitItem]
    let blockedPromoterMoves: [DigestBlockedPromoterMoveItem]
    let failedMonitoredRuns: [DigestFailedRunItem]
    let pendingOwnerQuestions: [DigestPendingOwnerQuestionItem]
    let agingOperatorCaptures: [DigestAgingOperatorCaptureItem]
    let queueDelta: DigestQueueDelta
    let quiet: Bool
}

struct DigestBuilderCommitItem: Codable {
    let runId: String
    let taskId: String?
    let taskTitle: String?
    let commitSubject: String
    let durationMs: Double?
}

struct DigestExplorerAdditionItem: Codable {
    let runId: String
    let taskCount: Int
    let watchlistAdds: Int
}

struct DigestDecomposerSplitItem: Codable {
    let runId: String
    let parentTaskId: String?
    let childTaskCount: Int
}

struct DigestBlockedPromoterMoveItem: Codable {
    let runId: String
    let promotedTaskIds: [String]
    let toReady: [String]
    let toBacklog: [String]
}

struct DigestFailedRunItem: Codable {
    let runId: String
    let workflow: String
    let status: String
    let startedAt: String
}

struct DigestPendingOwnerQuestionItem: Codable {
    let id: String
    let question: String
    let source: String
    let ageDays: Int
}

struct DigestAgingOperatorCaptureItem: Codable {
    let taskId: String
    let ageDays: Int
    let path: String
}

struct DigestQueueCounts: Codable {
    let backlog: Int
    let ready: Int
    let doing: Int
    let blocked: Int
}

struct DigestQueueCountDelta: Codable {
    let backlog: Int?
    let ready: Int?
    let doing: Int?
    let blocked: Int?
}

struct DigestQueueDelta: Codable {
    let current: DigestQueueCounts
    let previous: DigestQueueCounts?
    let delta: DigestQueueCountDelta
}

// MARK: - Attention

/// Mirror of the daemon's `GET /api/attention` envelope (see
/// `src/modules/autonomy/workflows/attention-digest/attention-route.ts`):
/// `{ data: { items: AttentionItem[] }, text: string }`. Strict decode so a
/// payload drift fails loudly instead of silently rendering an empty section.
struct AttentionResponse: Codable {
    let data: AttentionData
    let text: String
}

struct AttentionData: Codable {
    let items: [AttentionItem]
}

struct AttentionItem: Codable {
    let label: String
    let detail: String
}

// MARK: - Knowledge

/// Mirror of a single entry returned by the daemon's
/// `GET /api/knowledge/search` route. Decoding is restricted to the four
/// fields the shared `renderKnowledgeSearchPlain` helper consumes
/// (`src/modules/knowledge/render.ts`) so the macOS surface speaks the
/// same line shape as Telegram, the CLI, and the web `KnowledgePanel`.
struct KnowledgeEntry: Codable, Identifiable, Equatable {
    let id: String
    let type: String
    let status: String
    let title: String
}

/// Discriminated mirror of the daemon's `GET /api/knowledge/search`
/// response: `{ ok: true, entries: KnowledgeEntry[] }` on success and
/// `{ ok: false, reason: "semantic_unavailable" }` when no embedding-backed
/// knowledge provider is configured. Strict decode so payload drift fails
/// loudly instead of silently degrading the rendered surface.
enum KnowledgeSearchResponse: Decodable, Equatable {
    case success(entries: [KnowledgeEntry])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, entries, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let entries = try container.decode([KnowledgeEntry].self, forKey: .entries)
            self = .success(entries: entries)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "semantic_unavailable":
            self = .semanticUnavailable
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown knowledge search reason: \(reason)"
            )
        }
    }
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
