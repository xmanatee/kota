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

/// Renders knowledge entries one-to-one with the shared
/// `renderKnowledgeSearchPlain` helper exported by
/// `src/modules/knowledge/render.ts`: id, type, status, and title columns
/// padded to the widest value across the result set. Sharing this helper
/// keeps the macOS menu bar body identical to the Telegram, CLI, and web
/// surfaces — five operator pull-surfaces, one rendered line shape.
func renderKnowledgeSearchPlain(_ entries: [KnowledgeEntry]) -> String {
    let idWidth = max(entries.map { $0.id.count }.max() ?? 0, 2)
    let typeWidth = max(entries.map { $0.type.count }.max() ?? 0, 4)
    let statusWidth = max(entries.map { $0.status.count }.max() ?? 0, 6)
    return entries.map { e in
        let id = e.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let type = e.type.padding(toLength: typeWidth, withPad: " ", startingAt: 0)
        let status = e.status.padding(toLength: statusWidth, withPad: " ", startingAt: 0)
        return "\(id)  \(type)  \(status)  \(e.title)"
    }.joined(separator: "\n")
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

// MARK: - Memory

/// Mirror of a single entry returned by the daemon's
/// `GET /api/memory/search` route. Decoding is restricted to the three
/// fields the shared `renderMemorySearchPlain` helper consumes
/// (`src/modules/memory/render.ts` and the `MemoryListEntry` shape in
/// `src/core/server/kota-client.ts`) so the macOS surface speaks the same
/// line shape as Telegram, the CLI, and any other surface that consumes the
/// helper.
struct MemoryEntry: Codable, Identifiable, Equatable {
    let id: String
    let created: String
    let content: String
}

/// Renders memory entries one-to-one with the shared
/// `renderMemorySearchPlain` helper exported by
/// `src/modules/memory/render.ts`: id (padded to widest), created date
/// sliced to `YYYY-MM-DD HH:MM` (16 chars), and a 60-char snippet of the
/// content with newlines collapsed to single spaces. Sharing this helper
/// keeps the macOS menu bar body identical to Telegram, the CLI, and any
/// other surface that consumes the helper.
func renderMemorySearchPlain(_ entries: [MemoryEntry]) -> String {
    let idWidth = max(entries.map { $0.id.count }.max() ?? 0, 2)
    return entries.map { e in
        let id = e.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let dateRaw = String(e.created.prefix(16)).replacingOccurrences(of: "T", with: " ")
        let date = dateRaw.padding(toLength: 16, withPad: " ", startingAt: 0)
        let collapsed = e.content.replacingOccurrences(of: "\n", with: " ")
        let snippet = String(collapsed.prefix(60))
        return "\(id)  \(date)  \(snippet)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `GET /api/memory/search` response:
/// `{ ok: true, entries: MemoryEntry[] }` on success and
/// `{ ok: false, reason: "semantic_unavailable" }` when no embedding-backed
/// memory provider is configured. Strict decode so payload drift fails
/// loudly instead of silently degrading the rendered surface.
enum MemorySearchResponse: Decodable, Equatable {
    case success(entries: [MemoryEntry])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, entries, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let entries = try container.decode([MemoryEntry].self, forKey: .entries)
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
                debugDescription: "Unknown memory search reason: \(reason)"
            )
        }
    }
}

// MARK: - History

/// Mirror of a single conversation summary returned by the daemon's
/// `GET /api/history/search` route. Decoding is restricted to the eight
/// fields the shared `renderHistorySearchPlain` helper consumes
/// (`src/modules/history/render.ts` and the `ConversationRecord` shape in
/// `src/core/modules/provider-types.ts:9-19`) so the macOS surface speaks
/// the same line shape as Telegram, the CLI, and any other surface that
/// consumes the helper. `source` is the only optional field, matching the
/// upstream type one-to-one.
struct ConversationRecord: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let createdAt: String
    let updatedAt: String
    let model: String
    let messageCount: Int
    let cwd: String
    let source: String?
}

/// Renders conversation records one-to-one with the shared
/// `renderHistorySearchPlain` helper exported by
/// `src/modules/history/render.ts`: id (padded to widest, min width 2),
/// updatedAt sliced to the first 16 chars with `T` replaced by a space,
/// `messageCount` padded to width 4 followed by ` msgs`, and the title.
/// Sharing this helper keeps the macOS menu bar body identical to
/// Telegram, the CLI, and any other surface that consumes the helper.
func renderHistorySearchPlain(_ conversations: [ConversationRecord]) -> String {
    let idWidth = max(conversations.map { $0.id.count }.max() ?? 0, 2)
    return conversations.map { c in
        let id = c.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let updatedRaw = String(c.updatedAt.prefix(16)).replacingOccurrences(of: "T", with: " ")
        let updated = updatedRaw.padding(toLength: 16, withPad: " ", startingAt: 0)
        let countStr = String(c.messageCount)
        let countPadded = String(repeating: " ", count: max(0, 4 - countStr.count)) + countStr
        return "\(id)  \(updated)  \(countPadded) msgs  \(c.title)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `GET /api/history/search`
/// response: `{ ok: true, conversations: ConversationRecord[] }` on
/// success and `{ ok: false, reason: "semantic_unavailable" }` when the
/// configured history provider does not support semantic search. Strict
/// decode so payload drift fails loudly instead of silently degrading the
/// rendered surface.
enum HistorySearchResponse: Decodable, Equatable {
    case success(conversations: [ConversationRecord])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, conversations, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let conversations = try container.decode([ConversationRecord].self, forKey: .conversations)
            self = .success(conversations: conversations)
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
                debugDescription: "Unknown history search reason: \(reason)"
            )
        }
    }
}

// MARK: - Repo tasks search

/// Mirror of a single search hit returned by the daemon's
/// `GET /tasks/search` route (`src/modules/repo-tasks/routes.ts:531-563`).
/// Decoding is restricted to the eight fields the shared
/// `renderRepoTaskSearchPlain` helper consumes
/// (`src/modules/repo-tasks/render.ts` and the `RepoTaskSearchHit` shape in
/// `src/core/modules/provider-types.ts:258-267`) so the macOS surface
/// speaks the same line shape as Telegram, the CLI, and any other surface
/// that consumes the helper. Every field is required on the daemon side —
/// no nullable shape.
struct RepoTaskSearchHit: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let state: String
    let priority: String
    let area: String
    let summary: String
    let updatedAt: String
    let score: Double
}

/// Renders repo-task search hits one-to-one with the shared
/// `renderRepoTaskSearchPlain` helper exported by
/// `src/modules/repo-tasks/render.ts`: id (min width 2), state
/// (min width 5), priority (min width 4) padded to the widest value
/// across the result set, joined by two spaces, with the title last.
/// An empty result returns the empty string. Sharing this helper keeps
/// the macOS menu bar body identical to Telegram, the CLI, and any other
/// surface that consumes the helper.
func renderRepoTaskSearchPlain(_ hits: [RepoTaskSearchHit]) -> String {
    if hits.isEmpty { return "" }
    let idWidth = max(hits.map { $0.id.count }.max() ?? 0, 2)
    let stateWidth = max(hits.map { $0.state.count }.max() ?? 0, 5)
    let prioWidth = max(hits.map { $0.priority.count }.max() ?? 0, 4)
    return hits.map { hit in
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let state = hit.state.padding(toLength: stateWidth, withPad: " ", startingAt: 0)
        let priority = hit.priority.padding(toLength: prioWidth, withPad: " ", startingAt: 0)
        return "\(id)  \(state)  \(priority)  \(hit.title)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `GET /tasks/search` response:
/// `{ ok: true, tasks: RepoTaskSearchHit[] }` on success and
/// `{ ok: false, reason: "semantic_unavailable" }` when the configured
/// `repo-tasks` provider does not support semantic search. Strict decode
/// so payload drift fails loudly instead of silently degrading the
/// rendered surface.
enum TasksSearchResponse: Decodable, Equatable {
    case success(tasks: [RepoTaskSearchHit])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, tasks, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let tasks = try container.decode([RepoTaskSearchHit].self, forKey: .tasks)
            self = .success(tasks: tasks)
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
                debugDescription: "Unknown tasks search reason: \(reason)"
            )
        }
    }
}

// MARK: - Cross-store recall

/// Request body shape shared by `POST /recall`
/// (`src/modules/recall/routes.ts:50-86`) and `POST /answer`
/// (`src/modules/answer/routes.ts:48-77`). The daemon defines
/// `AnswerFilter = RecallFilter` (`src/core/server/kota-client.ts:634`)
/// so the wire shape is identical: `{ "query": <string>, "filter":
/// { "topK"?, "minScore"?, "sources"? } }`. Optional filter fields are
/// encoded only when set so each seam applies its own typed defaults;
/// nil values omit the key entirely (no `null`) via Swift's synthesized
/// `encodeIfPresent` for Optional Codable members.
struct RecallRequestFilter: Encodable {
    let topK: Int?
    let minScore: Double?
    let sources: [String]?
}

struct RecallRequestBody: Encodable {
    let query: String
    let filter: RecallRequestFilter
}

/// Mirror of one ranked, source-tagged hit returned by the daemon's
/// cross-store recall seam (`POST /recall` in
/// `src/modules/recall/routes.ts:50-86`). The wire shape is a
/// discriminated union over `source`, with per-arm fields matching
/// `src/core/server/kota-client.ts:533-571` one-to-one. Decoded as a
/// Swift enum with associated values so each arm carries exactly the
/// fields its surface needs — no nullable shape, no flattened struct
/// that drifts from the daemon's contract.
enum RecallHit: Decodable, Equatable {
    case knowledge(score: Double, id: String, title: String, preview: String, updated: String)
    case memory(score: Double, id: String, preview: String, created: String)
    case history(score: Double, id: String, title: String, cwd: String, updatedAt: String)
    case tasks(score: Double, id: String, title: String, state: String, priority: String, updatedAt: String)

    private enum CodingKeys: String, CodingKey {
        case source, score, id, title, preview, updated, created, cwd, updatedAt, state, priority
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let source = try container.decode(String.self, forKey: .source)
        let score = try container.decode(Double.self, forKey: .score)
        let id = try container.decode(String.self, forKey: .id)
        switch source {
        case "knowledge":
            let title = try container.decode(String.self, forKey: .title)
            let preview = try container.decode(String.self, forKey: .preview)
            let updated = try container.decode(String.self, forKey: .updated)
            self = .knowledge(score: score, id: id, title: title, preview: preview, updated: updated)
        case "memory":
            let preview = try container.decode(String.self, forKey: .preview)
            let created = try container.decode(String.self, forKey: .created)
            self = .memory(score: score, id: id, preview: preview, created: created)
        case "history":
            let title = try container.decode(String.self, forKey: .title)
            let cwd = try container.decode(String.self, forKey: .cwd)
            let updatedAt = try container.decode(String.self, forKey: .updatedAt)
            self = .history(score: score, id: id, title: title, cwd: cwd, updatedAt: updatedAt)
        case "tasks":
            let title = try container.decode(String.self, forKey: .title)
            let state = try container.decode(String.self, forKey: .state)
            let priority = try container.decode(String.self, forKey: .priority)
            let updatedAt = try container.decode(String.self, forKey: .updatedAt)
            self = .tasks(score: score, id: id, title: title, state: state, priority: priority, updatedAt: updatedAt)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .source,
                in: container,
                debugDescription: "Unknown recall hit source: \(source)"
            )
        }
    }

    var source: String {
        switch self {
        case .knowledge: return "knowledge"
        case .memory: return "memory"
        case .history: return "history"
        case .tasks: return "tasks"
        }
    }

    var id: String {
        switch self {
        case .knowledge(_, let id, _, _, _): return id
        case .memory(_, let id, _, _): return id
        case .history(_, let id, _, _, _): return id
        case .tasks(_, let id, _, _, _, _): return id
        }
    }

    var score: Double {
        switch self {
        case .knowledge(let score, _, _, _, _): return score
        case .memory(let score, _, _, _): return score
        case .history(let score, _, _, _, _): return score
        case .tasks(let score, _, _, _, _, _): return score
        }
    }

    var describe: String {
        switch self {
        case .knowledge(_, _, let title, _, _): return title
        case .memory(_, _, let preview, _): return preview
        case .history(_, _, let title, _, _): return title
        case .tasks(_, _, let title, let state, let priority, _): return "[\(state)/\(priority)] \(title)"
        }
    }
}

/// Renders cross-store recall hits one-to-one with the shared
/// `renderRecallHitsPlain` helper exported by
/// `src/modules/recall/render.ts:30-44`: source column padded to the
/// widest source (min width 6), score column right-padded to width 5
/// (`0.xxx`), id column padded to the widest id (min width 2), columns
/// joined by two spaces, and the per-source title taken from the
/// arm-specific helper. An empty result returns the empty string.
/// Sharing this helper keeps the macOS menu bar body identical to the
/// CLI, Telegram, the web `RecallPanel`, and any other surface that
/// consumes the helper.
func renderRecallHitsPlain(_ hits: [RecallHit]) -> String {
    if hits.isEmpty { return "" }
    let sourceWidth = max(hits.map { $0.source.count }.max() ?? 0, 6)
    let idWidth = max(hits.map { $0.id.count }.max() ?? 0, 2)
    let scoreWidth = 5
    return hits.map { hit in
        let source = hit.source.padding(toLength: sourceWidth, withPad: " ", startingAt: 0)
        let scoreStr = String(format: "%.3f", hit.score)
        let score = String(repeating: " ", count: max(0, scoreWidth - scoreStr.count)) + scoreStr
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        return "\(source)  \(score)  \(id)  \(hit.describe)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `POST /recall` response:
/// `{ ok: true, hits: RecallHit[] }` on success and
/// `{ ok: false, reason: "semantic_unavailable" }` when the recall
/// provider has no registered contributors. Strict decode so payload
/// drift fails loudly instead of silently degrading the rendered
/// surface.
enum RecallSearchResponse: Decodable, Equatable {
    case success(hits: [RecallHit])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, hits, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let hits = try container.decode([RecallHit].self, forKey: .hits)
            self = .success(hits: hits)
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
                debugDescription: "Unknown recall reason: \(reason)"
            )
        }
    }
}

// MARK: - Cited answer

/// Mirror of the daemon's `AnswerCitation` shape
/// (`src/core/server/kota-client.ts:642-645`):
/// `{ source: RecallSource, id: string }`. Each citation is keyed by the
/// same `{ source, id }` discriminator as the underlying `RecallHit` so
/// the response is always reconstructable against the `hits` list — no
/// free-form prose pointers, no hallucinated sources. `source` decodes
/// to the same string discriminator the existing `RecallHit` arms use
/// (`"knowledge" | "memory" | "history" | "tasks"`).
struct AnswerCitation: Codable, Equatable {
    let source: String
    let id: String
}

/// Renders cited-answer citations one-to-one with the shared
/// `renderAnswerCitationsPlain` helper exported by
/// `src/modules/answer/render.ts:32-53`: each citation is resolved
/// against the typed `RecallHit` list by `{ source, id }`, unresolved
/// rows are dropped, source column is padded to the widest source
/// (min width 6), id column is padded to the widest id (min width 2),
/// score column is right-padded to width 5 (`0.xxx`), columns joined
/// by two spaces, and the per-source title comes from the arm-specific
/// helper (`title` for knowledge/history, `preview` for memory,
/// `[state/priority] title` for tasks). An empty citation list — or
/// a list whose every entry fails to resolve — returns the empty
/// string. Sharing this helper keeps the macOS menu bar body identical
/// to the CLI, Telegram, and web `AnswerPanel` surfaces.
func renderAnswerCitationsPlain(
    _ citations: [AnswerCitation],
    hits: [RecallHit]
) -> String {
    if citations.isEmpty { return "" }
    var byKey: [String: RecallHit] = [:]
    for hit in hits {
        byKey["\(hit.source):\(hit.id)"] = hit
    }
    let rows: [RecallHit] = citations.compactMap { byKey["\($0.source):\($0.id)"] }
    if rows.isEmpty { return "" }
    let sourceWidth = max(rows.map { $0.source.count }.max() ?? 0, 6)
    let idWidth = max(rows.map { $0.id.count }.max() ?? 0, 2)
    let scoreWidth = 5
    return rows.map { hit in
        let source = hit.source.padding(toLength: sourceWidth, withPad: " ", startingAt: 0)
        let scoreStr = String(format: "%.3f", hit.score)
        let score = String(repeating: " ", count: max(0, scoreWidth - scoreStr.count)) + scoreStr
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        return "\(source)  \(score)  \(id)  \(hit.describe)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `POST /answer` response
/// (`src/core/server/kota-client.ts:662-672`): one synthesized-success
/// arm carrying `answer`, `citations`, and the typed `RecallHit[]` they
/// resolve against, plus three `ok: false` failure arms tagged by
/// `reason`. Strict decode so payload drift fails loudly instead of
/// silently degrading the rendered surface.
///
/// - `noHits` — recall returned zero hits; nothing to synthesize.
/// - `semanticUnavailable` — recall itself is unconfigured (forwarded
///   verbatim from the recall seam).
/// - `synthesisFailed` — the model call failed or produced malformed
///   citations that survived the single allowed retry.
enum AnswerResult: Decodable, Equatable {
    case success(answer: String, citations: [AnswerCitation], hits: [RecallHit])
    case noHits
    case semanticUnavailable
    case synthesisFailed

    private enum CodingKeys: String, CodingKey {
        case ok, answer, citations, hits, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let answer = try container.decode(String.self, forKey: .answer)
            let citations = try container.decode([AnswerCitation].self, forKey: .citations)
            let hits = try container.decode([RecallHit].self, forKey: .hits)
            self = .success(answer: answer, citations: citations, hits: hits)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "no_hits":
            self = .noHits
        case "semantic_unavailable":
            self = .semanticUnavailable
        case "synthesis_failed":
            self = .synthesisFailed
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown answer reason: \(reason)"
            )
        }
    }
}

// MARK: - Cross-store capture

/// Target store for `DaemonClient.capture`. Mirrors the daemon's
/// `CaptureTarget` union (`src/core/server/kota-client.ts:758`). Adding a
/// fifth contributor extends this enum and the `CaptureRecord` arms below.
enum CaptureTarget: String, Codable, Equatable {
    case memory
    case knowledge
    case tasks
    case inbox
}

/// Discriminated mirror of the daemon's `CaptureRecord` union
/// (`src/core/server/kota-client.ts:760-797`). Each successful capture
/// returns the typed identifier the underlying store minted; the
/// filesystem-backed contributors (tasks, inbox) additionally carry the
/// path their writer minted so a caller can resolve back to the
/// underlying store. Decoding is keyed by the wire `target` field, with
/// every per-arm field required on the daemon side — no nullable shape.
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

/// Discriminated mirror of the daemon's `CaptureResult` envelope
/// (`src/core/server/kota-client.ts:833-846`): one `ok: true` arm carrying
/// the typed `CaptureRecord` plus three `ok: false` arms tagged by
/// `reason`. Strict decode so payload drift fails loudly instead of
/// silently degrading the rendered surface.
///
/// - `ambiguous` — the classifier could not pick a single target; the
///   `suggestions` list is the contributors it considered. The caller
///   re-issues with an explicit `target` to disambiguate.
/// - `noContributors` — the seam has no registered contributors at all.
/// - `contributorFailed` — the chosen contributor threw; `target` is the
///   contributor that ran and `message` is the verbatim error.
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
/// `src/modules/capture/render.ts:25-36`: `<target>  <recordId>` for
/// memory/knowledge and `<target>  <recordId>  <path>` for tasks/inbox.
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
/// `src/modules/capture/render.ts:38-50`. Sharing this helper keeps the
/// macOS menu bar body identical to the CLI, web, and any other surface
/// that consumes the helper. The chat-surface variant
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

/// Request body shape for `POST /capture`
/// (`src/modules/capture/routes.ts:43-72`):
/// `{ "text": <string>, "filter"?: { "target"?, "hint"? } }`. Optional
/// filter fields are encoded only when set so the seam applies its own
/// typed defaults (classifier picks the target, no hint passed to the
/// prompt). Nil values omit the key entirely (no `null`) via Swift's
/// synthesized `encodeIfPresent` for Optional Codable members. When both
/// `target` and `hint` are nil, the call site omits the `filter` key
/// entirely.
struct CaptureRequestFilter: Encodable {
    let target: CaptureTarget?
    let hint: String?
}

struct CaptureRequestBody: Encodable {
    let text: String
    let filter: CaptureRequestFilter?
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
