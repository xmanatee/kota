import Foundation

/// Connection-wide daemon state. It survives scope changes except for the
/// active scope selection itself, which is reconciled against each identity
/// projection.
struct ConnectionDomainState {
    var health: DaemonHealth = .unknown
    var identity: ClientIdentity?
    var capabilities: CapabilityReadinessResponse?
    var activeScopeId: String?
    var diagnostic: DaemonConnectionDiagnostic = .noScope

    init() {}
}

/// State populated by the daemon's continuously refreshed operator overview.
/// Every member is scope-owned except approvals and owner questions, whose
/// daemon routes are global but share the same refresh cadence.
struct ActivityDomainState {
    var activeRuns: [ActiveRun] = []
    var pendingApprovals: [ApprovalRequest] = []
    var pendingOwnerQuestions: [OwnerQuestion] = []
    var taskQueue: TaskQueueResponse?
    var activeSessions: [SessionSummary] = []
    var recentRuns: [RunSummary] = []
    var workflowDefinitions: [WorkflowDefinitionSummary] = []

    init() {}

    mutating func clear() {
        self = ActivityDomainState()
    }

    mutating func clearScopeOwned() {
        activeRuns = []
        activeSessions = []
        recentRuns = []
        workflowDefinitions = []
    }
}

/// Explicitly requested content and mutation state. This is cleared when the
/// daemon disconnects so a stale response cannot be presented as live data.
struct ContentDomainState {
    var digest: DigestResponse?
    var digestError: String?
    var isLoadingDigest = false
    var attention: AttentionResponse?
    var attentionError: String?
    var isLoadingAttention = false
    var knowledgeQuery = ""
    var knowledgeResult: KnowledgeSearchResponse?
    var knowledgeError: String?
    var isLoadingKnowledge = false
    var memoryQuery = ""
    var memoryResult: MemorySearchResponse?
    var memoryError: String?
    var isLoadingMemory = false
    var historyQuery = ""
    var historyResult: HistorySearchResponse?
    var historyError: String?
    var isLoadingHistory = false
    var tasksQuery = ""
    var tasksResult: TasksSearchResponse?
    var tasksError: String?
    var isLoadingTasksSearch = false
    var recallQuery = ""
    var recallResult: RecallSearchResponse?
    var recallError: String?
    var isLoadingRecall = false
    var answerQuery = ""
    var answerResult: AnswerResult?
    var answerError: String?
    var isLoadingAnswer = false
    var answerLogEntries: [AnswerHistoryEntry] = []
    var answerLogError: String?
    var isLoadingAnswerLog = false
    var answerLogHasMore = false
    var answerShowOpenId: String?
    var answerShowRecord: AnswerHistoryRecord?
    var answerShowMissing = false
    var answerShowError: String?
    var isLoadingAnswerShow = false
    var captureDraft = ""
    var captureTarget: CaptureTargetChoice = .auto
    var captureHint = ""
    var captureResult: CaptureResult?
    var captureError: String?
    var isLoadingCapture = false
    var retractTarget: RetractTarget = .memory {
        didSet {
            guard retractTarget != oldValue else { return }
            retractIdentifier = ""
            retractConfirmed = false
            retractResult = nil
            retractError = nil
        }
    }
    var retractIdentifier = "" {
        didSet {
            guard retractIdentifier != oldValue else { return }
            if retractConfirmed { retractConfirmed = false }
        }
    }
    var retractResult: RetractResult?
    var retractError: String?
    var isLoadingRetract = false
    var retractConfirmed = false

    init() {}

    /// Preserve operator drafts and search queries across a reconnect while
    /// removing every response that claimed to be live.
    mutating func clearLiveResults() {
        let drafts = (
            knowledgeQuery, memoryQuery, historyQuery, tasksQuery, recallQuery,
            answerQuery, captureDraft, captureTarget, captureHint,
            retractTarget, retractIdentifier
        )
        self = ContentDomainState()
        knowledgeQuery = drafts.0
        memoryQuery = drafts.1
        historyQuery = drafts.2
        tasksQuery = drafts.3
        recallQuery = drafts.4
        answerQuery = drafts.5
        captureDraft = drafts.6
        captureTarget = drafts.7
        captureHint = drafts.8
        retractTarget = drafts.9
        retractIdentifier = drafts.10
    }
}

/// Canonical daemon-provided UI graph plus its one live-event projection.
struct SharedUiDomainState {
    var bundle: UiSurfaceBundle?
    var error: String?
    var isLoading = false
    var eventsConnected = false
    var liveLogEntries: [String: [UiLogEntry]] = [:]

    init() {}

    mutating func clear() {
        self = SharedUiDomainState()
    }
}
