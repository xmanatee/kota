import Foundation
import Security
import SwiftUI

private let pollInterval: TimeInterval = 5
private let keychainService = "com.kota.menubar"
private let keychainAccount = "remote-daemon-token"

// MARK: - Keychain helpers

private func keychainSave(token: String) {
    let data = Data(token.utf8)
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: keychainService,
        kSecAttrAccount: keychainAccount,
        kSecValueData: data,
    ]
    SecItemDelete(query as CFDictionary)
    SecItemAdd(query as CFDictionary, nil)
}

private func keychainRead() -> String? {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: keychainService,
        kSecAttrAccount: keychainAccount,
        kSecReturnData: true,
        kSecMatchLimit: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}

private func keychainDelete() {
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: keychainService,
        kSecAttrAccount: keychainAccount,
    ]
    SecItemDelete(query as CFDictionary)
}

// MARK: - Connection mode

public enum DaemonConnectionMode {
    case local
    case remote
}

// MARK: - AppState

@MainActor
public final class AppState: ObservableObject {
    @Published var health: DaemonHealth = .unknown
    @Published var activeRuns: [ActiveRun] = []
    @Published var pendingApprovals: [ApprovalRequest] = []
    @Published var pendingOwnerQuestions: [OwnerQuestion] = []
    @Published var taskQueue: TaskQueueResponse?
    @Published var activeSessions: [SessionSummary] = []
    @Published var recentRuns: [RunSummary] = []
    @Published var digest: DigestResponse?
    @Published var digestError: String?
    @Published var isLoadingDigest: Bool = false
    @Published var attention: AttentionResponse?
    @Published var attentionError: String?
    @Published var isLoadingAttention: Bool = false
    @Published var knowledgeQuery: String = ""
    @Published var knowledgeResult: KnowledgeSearchResponse?
    @Published var knowledgeError: String?
    @Published var isLoadingKnowledge: Bool = false
    @Published var memoryQuery: String = ""
    @Published var memoryResult: MemorySearchResponse?
    @Published var memoryError: String?
    @Published var isLoadingMemory: Bool = false
    @Published var historyQuery: String = ""
    @Published var historyResult: HistorySearchResponse?
    @Published var historyError: String?
    @Published var isLoadingHistory: Bool = false
    @Published var tasksQuery: String = ""
    @Published var tasksResult: TasksSearchResponse?
    @Published var tasksError: String?
    @Published var isLoadingTasksSearch: Bool = false
    @Published var recallQuery: String = ""
    @Published var recallResult: RecallSearchResponse?
    @Published var recallError: String?
    @Published var isLoadingRecall: Bool = false
    @Published var answerQuery: String = ""
    @Published var answerResult: AnswerResult?
    @Published var answerError: String?
    @Published var isLoadingAnswer: Bool = false
    @Published var answerLogEntries: [AnswerHistoryEntry] = []
    @Published var answerLogError: String?
    @Published var isLoadingAnswerLog: Bool = false
    @Published var answerLogHasMore: Bool = false
    @Published var answerShowOpenId: String?
    @Published var answerShowRecord: AnswerHistoryRecord?
    @Published var answerShowMissing: Bool = false
    @Published var answerShowError: String?
    @Published var isLoadingAnswerShow: Bool = false
    @Published var captureDraft: String = ""
    @Published var captureTarget: CaptureTargetChoice = .auto
    @Published var captureHint: String = ""
    @Published var captureResult: CaptureResult?
    @Published var captureError: String?
    @Published var isLoadingCapture: Bool = false
    @Published var retractTarget: RetractTarget = .memory {
        didSet {
            guard retractTarget != oldValue else { return }
            retractIdentifier = ""
            retractConfirmed = false
            retractResult = nil
            retractError = nil
        }
    }
    @Published var retractIdentifier: String = "" {
        didSet {
            guard retractIdentifier != oldValue else { return }
            if retractConfirmed { retractConfirmed = false }
        }
    }
    @Published var retractResult: RetractResult?
    @Published var retractError: String?
    @Published var isLoadingRetract: Bool = false
    @Published var retractConfirmed: Bool = false

    // Thin-client contract surfaces. `identity` and `capabilities` populate
    // on every successful refresh so the UI can hide controls whose
    // capability is `unavailable` (dashboard, semantic search) and label
    // identity-aware status text without UserDefaults guessing. `workflowDefinitions`
    // backs the workflow trigger picker so the operator never types free
    // text. Each surface is `nil` when the daemon is unreachable.
    @Published var identity: ClientIdentity?
    @Published var capabilities: CapabilityReadinessResponse?
    @Published var workflowDefinitions: [WorkflowDefinitionSummary] = []

    /// Active project id used to scope every project-scoped daemon route
    /// (`/status`, `/workflow/runs`, `/workflow/trigger`, `/sessions`,
    /// …). `nil` until the first identity refresh resolves the registry's
    /// default. Reseeds to `identity.projects.defaultProjectId` if the
    /// current selection is no longer in the registry, matching the web
    /// `ProjectProvider` behavior. Operator-driven switches go through
    /// `setActiveProjectId(_:)`.
    @Published public private(set) var activeProjectId: String?

    /// Operator-facing classification of the current connection. Replaces
    /// the historical "Daemon offline" collapse with a discriminated state
    /// that names which project, base URL, pid, and failure mode the menu
    /// bar should render. Updated on every refresh — see
    /// `deriveLocalDaemonDiagnostic` / `deriveRemoteDaemonDiagnostic`.
    @Published var diagnostic: DaemonConnectionDiagnostic = .noProject

    @Published var projectDir: URL? {
        didSet {
            if let dir = projectDir {
                UserDefaults.standard.set(dir.path, forKey: "projectDirectory")
            }
        }
    }

    /// Non-empty means remote mode is active; stored in UserDefaults (URL only, token in Keychain).
    @Published var remoteURL: String = "" {
        didSet { UserDefaults.standard.set(remoteURL, forKey: "remoteDaemonURL") }
    }

    @Published var notificationsEnabled: Bool = UserDefaults.standard.object(forKey: "notificationsEnabled") as? Bool ?? true {
        didSet { UserDefaults.standard.set(notificationsEnabled, forKey: "notificationsEnabled") }
    }

    var isPopoverOpen: Bool = false

    var connectionMode: DaemonConnectionMode {
        remoteURL.isEmpty ? .local : .remote
    }

    public let client: DaemonClient
    public let notifications: NotificationManaging
    public let platform: PlatformAffordances
    private var pollTask: Task<Void, Never>?

    private var knownFailedRunIDs: Set<String> = []
    private var knownApprovalIDs: Set<String> = []
    private var knownOwnerQuestionIDs: Set<String> = []
    private var notificationStateInitialized = false
    private var lastIdentityProbe: DaemonIdentityProbe?

    /// Production callers (macOS shell, iOS shell) inject the platform
    /// affordances + notification surface they ship with and let polling
    /// start immediately. Tests pass `InertPlatformAffordances` /
    /// `InertNotificationManager` (or a recording stub) and
    /// `startPollingOnInit: false` so `AppState` can be constructed
    /// without touching `UNUserNotificationCenter.current()` (which
    /// crashes when the Swift test runner is launched outside a `.app`
    /// bundle) and without spawning a background `Task` that the test
    /// harness cannot observe.
    public init(
        client: DaemonClient? = nil,
        notifications: NotificationManaging = InertNotificationManager(),
        platform: PlatformAffordances = InertPlatformAffordances(),
        startPollingOnInit: Bool = true
    ) {
        self.client = client ?? DaemonClient()
        self.notifications = notifications
        self.platform = platform
        if let stored = UserDefaults.standard.string(forKey: "projectDirectory") {
            projectDir = URL(fileURLWithPath: stored)
        }
        remoteURL = UserDefaults.standard.string(forKey: "remoteDaemonURL") ?? ""
        if startPollingOnInit {
            notifications.requestAuthorization()
            startPolling()
        }
    }

    /// True only when the daemon currently advertises a `dashboard`
    /// capability with `status: ready`. The MenuBarView hides the
    /// "Open Dashboard" action when this is false so the operator never
    /// chases a broken `localhost:3000` URL.
    var isDashboardAvailable: Bool {
        identity?.dashboard.isAvailable ?? false
    }

    var isWorkflowDispatchPaused: Bool {
        health.isDispatchPaused
    }

    /// Dashboard URL the operator should open. Returns nil when the
    /// daemon does not advertise a ready dashboard capability — the UI
    /// must hide the action in that case rather than constructing a URL.
    var webUIURL: URL? {
        guard let identity, case .available(let path) = identity.dashboard else {
            return nil
        }
        if !remoteURL.isEmpty, let base = URL(string: remoteURL) {
            return URL(string: path, relativeTo: base)?.absoluteURL
        }
        guard let connection = client.connection else { return nil }
        return URL(string: path, relativeTo: connection.baseURL)?.absoluteURL
    }

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
            }
        }
    }

    func saveRemoteConfig(url: String, token: String) {
        remoteURL = url
        if token.isEmpty {
            keychainDelete()
        } else {
            keychainSave(token: token)
        }
        startPolling()
    }

    func clearRemoteConfig() {
        remoteURL = ""
        keychainDelete()
        startPolling()
    }

    func loadRemoteToken() -> String {
        keychainRead() ?? ""
    }

    func refresh() async {
        if !remoteURL.isEmpty {
            await refreshRemote()
        } else {
            await refreshLocal()
        }
    }

    private func refreshRemote() async {
        guard let url = URL(string: remoteURL), url.scheme != nil, url.host != nil else {
            health = .error("Invalid remote URL")
            diagnostic = .remoteInvalidURL(input: remoteURL)
            clearOnDemandForOffline()
            identity = nil
            capabilities = nil
            workflowDefinitions = []
            return
        }
        let token = keychainRead() ?? ""
        client.setRemoteConnection(url: url, token: token)
        await fetchAll()
        diagnostic = deriveRemoteDaemonDiagnostic(
            remoteURL: remoteURL,
            identityProbe: lastIdentityProbe
        )
    }

    private func refreshLocal() async {
        guard let dir = projectDir else {
            health = .offline
            diagnostic = .noProject
            resetOfflineDaemonState()
            return
        }

        let controlFileState = classifyDaemonControlFile(projectDir: dir)
        switch controlFileState {
        case .missing, .unreadable, .stale:
            health = .offline
            diagnostic = deriveLocalDaemonDiagnostic(
                selectedProjectDir: dir,
                controlFileState: controlFileState,
                identityProbe: nil
            )
            resetOfflineDaemonState()
            return
        case .fresh:
            break
        }

        let connected = client.refreshConnection(projectDir: dir)
        guard connected else {
            // The control file went away (or became unreadable) between the
            // classification above and the connection refresh — fall through
            // to the same offline rendering instead of pretending we tried.
            health = .offline
            diagnostic = deriveLocalDaemonDiagnostic(
                selectedProjectDir: dir,
                controlFileState: classifyDaemonControlFile(projectDir: dir),
                identityProbe: nil
            )
            resetOfflineDaemonState()
            return
        }

        await fetchAll()
        diagnostic = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: controlFileState,
            identityProbe: lastIdentityProbe
        )
    }

    private func resetOfflineDaemonState() {
        activeRuns = []
        pendingApprovals = []
        pendingOwnerQuestions = []
        taskQueue = nil
        activeSessions = []
        recentRuns = []
        identity = nil
        capabilities = nil
        workflowDefinitions = []
        activeProjectId = nil
        lastIdentityProbe = nil
        clearOnDemandForOffline()
    }

    /// Switch the active project. Throws if `projectId` is not in the
    /// current registry — the caller (project selector view) should
    /// only ever pass a known id, so an unknown id is a programming
    /// error, not a runtime fallback. Switching clears project-scoped
    /// runtime state immediately so a stale row can never paint the
    /// new project's view, then triggers an immediate refresh.
    public func setActiveProjectId(_ projectId: String) {
        guard let identity, identity.projects.projects.contains(where: { $0.projectId == projectId }) else {
            assertionFailure("setActiveProjectId(\(projectId)): not in identity.projects")
            return
        }
        guard projectId != activeProjectId else { return }
        activeProjectId = projectId
        activeRuns = []
        pendingApprovals = []
        pendingOwnerQuestions = []
        taskQueue = nil
        activeSessions = []
        recentRuns = []
        Task { await refresh() }
    }

    /// Drops any cached on-demand body (digest, attention) when the daemon
    /// transitions offline so a stale rollup never paints over a disconnected
    /// state. These bodies are only loaded explicitly, so the next load
    /// happens once the daemon is reachable again.
    private func clearOnDemandForOffline() {
        digest = nil
        digestError = nil
        isLoadingDigest = false
        attention = nil
        attentionError = nil
        isLoadingAttention = false
        knowledgeResult = nil
        knowledgeError = nil
        isLoadingKnowledge = false
        memoryResult = nil
        memoryError = nil
        isLoadingMemory = false
        historyResult = nil
        historyError = nil
        isLoadingHistory = false
        tasksResult = nil
        tasksError = nil
        isLoadingTasksSearch = false
        recallResult = nil
        recallError = nil
        isLoadingRecall = false
        answerResult = nil
        answerError = nil
        isLoadingAnswer = false
        answerLogEntries = []
        answerLogError = nil
        isLoadingAnswerLog = false
        answerLogHasMore = false
        answerShowOpenId = nil
        answerShowRecord = nil
        answerShowMissing = false
        answerShowError = nil
        isLoadingAnswerShow = false
        captureResult = nil
        captureError = nil
        isLoadingCapture = false
        retractResult = nil
        retractError = nil
        isLoadingRetract = false
        retractConfirmed = false
    }

    /// Pulls the on-demand 24h rollup from `/api/digest`. Errors land in
    /// `digestError` so the view can surface the daemon's typed failure
    /// without preserving a stale body.
    func loadDigest() async {
        isLoadingDigest = true
        digestError = nil
        do {
            digest = try await client.fetchDigest()
        } catch {
            digest = nil
            digestError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingDigest = false
    }

    /// Pulls the on-demand attention rollup from `/api/attention`. Mirrors
    /// `loadDigest`: failures land in `attentionError` rather than silently
    /// folding back to the digest body.
    func loadAttention() async {
        isLoadingAttention = true
        attentionError = nil
        do {
            attention = try await client.fetchAttention()
        } catch {
            attention = nil
            attentionError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingAttention = false
    }

    /// Pulls semantic knowledge search results from `/api/knowledge/search`.
    /// Empty / whitespace-only queries clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `knowledgeError`; the typed `semanticUnavailable` branch lands
    /// in `knowledgeResult` so the view renders the daemon's explanation
    /// without retrying the request.
    func loadKnowledge() async {
        let trimmed = knowledgeQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            knowledgeResult = nil
            knowledgeError = nil
            isLoadingKnowledge = false
            return
        }
        isLoadingKnowledge = true
        knowledgeError = nil
        do {
            knowledgeResult = try await client.searchKnowledge(query: trimmed, limit: 10)
        } catch {
            knowledgeResult = nil
            knowledgeError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingKnowledge = false
    }

    /// Pulls semantic memory search results from `/api/memory/search`.
    /// Empty / whitespace-only queries clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `memoryError`; the typed `semanticUnavailable` branch lands in
    /// `memoryResult` so the view renders the daemon's explanation without
    /// retrying the request.
    func loadMemory() async {
        let trimmed = memoryQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            memoryResult = nil
            memoryError = nil
            isLoadingMemory = false
            return
        }
        isLoadingMemory = true
        memoryError = nil
        do {
            memoryResult = try await client.searchMemory(query: trimmed, limit: 10)
        } catch {
            memoryResult = nil
            memoryError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingMemory = false
    }

    /// Pulls semantic history search results from `/api/history/search`.
    /// Empty / whitespace-only queries clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `historyError`; the typed `semanticUnavailable` branch lands in
    /// `historyResult` so the view renders the daemon's explanation without
    /// retrying the request.
    func loadHistory() async {
        let trimmed = historyQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            historyResult = nil
            historyError = nil
            isLoadingHistory = false
            return
        }
        isLoadingHistory = true
        historyError = nil
        do {
            historyResult = try await client.searchHistory(query: trimmed, limit: 10)
        } catch {
            historyResult = nil
            historyError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingHistory = false
    }

    /// Pulls semantic repo-task search results from the daemon's
    /// `/tasks/search` route. Empty / whitespace-only queries clear any prior
    /// result and skip the request — the view surfaces the inline usage hint
    /// instead. Failures land in `tasksError`; the typed `semanticUnavailable`
    /// branch lands in `tasksResult` so the view renders the daemon's
    /// explanation without retrying the request.
    func loadTasksSearch() async {
        let trimmed = tasksQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            tasksResult = nil
            tasksError = nil
            isLoadingTasksSearch = false
            return
        }
        isLoadingTasksSearch = true
        tasksError = nil
        do {
            tasksResult = try await client.searchTasks(query: trimmed, limit: 10, states: nil)
        } catch {
            tasksResult = nil
            tasksError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingTasksSearch = false
    }

    /// Pulls cross-store recall results from the daemon's `POST /recall`
    /// route. Empty / whitespace-only queries clear any prior result and skip
    /// the request — the view surfaces the inline usage hint instead. Failures
    /// land in `recallError`; the typed `semanticUnavailable` branch lands in
    /// `recallResult` so the view renders the daemon's explanation without
    /// retrying the request. `topK`, `minScore`, and `sources` are left nil so
    /// the seam applies its own typed defaults (every registered contributor,
    /// `RECALL_DEFAULT_TOP_K = 20`, no min-score floor).
    func loadRecall() async {
        let trimmed = recallQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            recallResult = nil
            recallError = nil
            isLoadingRecall = false
            return
        }
        isLoadingRecall = true
        recallError = nil
        do {
            recallResult = try await client.recall(
                query: trimmed,
                topK: nil,
                minScore: nil,
                sources: nil
            )
        } catch {
            recallResult = nil
            recallError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingRecall = false
    }

    /// Pulls a synthesized cited answer from the daemon's `POST /answer`
    /// route. Empty / whitespace-only queries clear any prior result and
    /// skip the request — the view surfaces the inline usage hint instead.
    /// Failures land in `answerError`; the three typed `ok: false` arms
    /// (`noHits`, `semanticUnavailable`, `synthesisFailed`) land in
    /// `answerResult` so the view renders the daemon's degradation notice
    /// without retrying the request. `topK`, `minScore`, and `sources`
    /// are left nil so the seam applies its own typed defaults.
    func loadAnswer() async {
        let trimmed = answerQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            answerResult = nil
            answerError = nil
            isLoadingAnswer = false
            return
        }
        isLoadingAnswer = true
        answerError = nil
        do {
            answerResult = try await client.answer(
                query: trimmed,
                topK: nil,
                minScore: nil,
                sources: nil
            )
        } catch {
            answerResult = nil
            answerError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingAnswer = false
    }

    /// Page size for the persisted answer-history list. Mirrors the
    /// mobile `ANSWER_LOG_PAGE_SIZE` so a paginated request returns the
    /// same row count on every operator surface, and the
    /// `entries.count >= limit` heuristic the daemon's list route exposes
    /// translates to the same `answerLogHasMore` truth value.
    static let answerLogPageSize: Int = 20

    /// Pulls the persisted cited-answer history from the daemon's
    /// `GET /answers` daemon-control route. The first call clears any
    /// prior list, error, or open-detail state. A `beforeId` cursor
    /// appends to the existing list instead of resetting, mirroring the
    /// mobile `loadAnswerLog({ beforeId })` paginate path. Failures land
    /// in `answerLogError`; successful loads update `answerLogHasMore`
    /// from the cursor heuristic (`entries.count >= limit`).
    func loadAnswerLog(beforeId: String? = nil) async {
        let append = beforeId != nil
        isLoadingAnswerLog = true
        answerLogError = nil
        if !append {
            answerShowOpenId = nil
            answerShowRecord = nil
            answerShowMissing = false
            answerShowError = nil
            isLoadingAnswerShow = false
        }
        let limit = AppState.answerLogPageSize
        do {
            let result = try await client.answerLog(
                filter: AnswerHistoryListFilter(limit: limit, beforeId: beforeId)
            )
            if append {
                answerLogEntries.append(contentsOf: result.entries)
            } else {
                answerLogEntries = result.entries
            }
            answerLogHasMore = result.entries.count >= limit
        } catch {
            answerLogError = DaemonErrorPresenter.message(for: error)
            answerLogHasMore = false
        }
        isLoadingAnswerLog = false
    }

    /// Cursor paginate. Reads the last entry's id and asks the daemon for
    /// the next page before it. A no-op when the list is empty (which
    /// also keeps `answerLogHasMore` honest after a refresh).
    func loadMoreAnswerLog() async {
        guard let last = answerLogEntries.last else { return }
        await loadAnswerLog(beforeId: last.id)
    }

    /// Pulls the full persisted envelope for one record from the daemon's
    /// `GET /answers/:id` route. Sets `answerShowOpenId` so the view can
    /// pin which row the operator opened, and folds the discriminated
    /// `AnswerHistoryShowResult` into typed view state: `notFound` lands
    /// in `answerShowMissing` (the typed banner), `success` lands in
    /// `answerShowRecord`. Transport / decode failures land in
    /// `answerShowError`.
    func openAnswerShow(id: String) async {
        answerShowOpenId = id
        answerShowRecord = nil
        answerShowMissing = false
        answerShowError = nil
        isLoadingAnswerShow = true
        do {
            let result = try await client.answerShow(id: id)
            switch result {
            case .success(let record):
                answerShowRecord = record
                answerShowMissing = false
            case .notFound:
                answerShowRecord = nil
                answerShowMissing = true
            }
        } catch {
            answerShowRecord = nil
            answerShowMissing = false
            answerShowError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingAnswerShow = false
    }

    /// Drops any open answer-history detail state without touching the
    /// list. Mirrors mobile's `closeAnswerShow` so the operator can
    /// collapse the detail back to the list view from the macOS surface
    /// without re-loading the list.
    func closeAnswerShow() {
        answerShowOpenId = nil
        answerShowRecord = nil
        answerShowMissing = false
        answerShowError = nil
        isLoadingAnswerShow = false
    }

    /// Posts the current draft through the daemon's `POST /capture` route.
    /// Empty / whitespace-only drafts clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `captureError`; the four typed `CaptureResult` arms
    /// (`success`, `ambiguous`, `noContributors`, `contributorFailed`) all
    /// land in `captureResult` so the view renders the daemon's verdict
    /// without retrying the request. The `captureTarget` picker collapses
    /// `.auto` to a `nil` target so the seam classifier picks the store;
    /// `captureHint` collapses an empty string to `nil` so the daemon
    /// skips passing the hint to the prompt.
    func loadCapture() async {
        let trimmed = captureDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            captureResult = nil
            captureError = nil
            isLoadingCapture = false
            return
        }
        isLoadingCapture = true
        captureError = nil
        let trimmedHint = captureHint.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedHint: String? = trimmedHint.isEmpty ? nil : trimmedHint
        do {
            captureResult = try await client.capture(
                text: trimmed,
                target: captureTarget.resolved,
                hint: resolvedHint
            )
        } catch {
            captureResult = nil
            captureError = DaemonErrorPresenter.message(for: error)
        }
        isLoadingCapture = false
    }

    /// Posts the current retract draft through the daemon's
    /// `POST /retract` route. Submission is gated through the pure
    /// `evaluateRetractSubmit` helper so the gate is unit-testable
    /// without instantiating `AppState`. The first call with a non-empty
    /// identifier flips `retractConfirmed` and returns without firing,
    /// mirroring how `RetractPanel.tsx` already gates the dashboard
    /// surface against the seam's `dangerous` risk classification. The
    /// second call (once the operator has acknowledged) builds the typed
    /// `RetractRequest` from the picker + identifier draft and consumes
    /// `DaemonClient.retract`. Failures land in `retractError`; the four
    /// typed `RetractResult` arms (`success`, `noContributors`,
    /// `notFound`, `contributorFailed`) all land in `retractResult` so
    /// the view renders the daemon's verdict without retrying. Empty /
    /// whitespace identifiers clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead.
    func loadRetract() async {
        let outcome = evaluateRetractSubmit(
            target: retractTarget,
            identifier: retractIdentifier,
            confirmed: retractConfirmed
        )
        switch outcome {
        case .skip:
            retractResult = nil
            retractError = nil
            retractConfirmed = false
            isLoadingRetract = false
        case .requireConfirmation:
            retractConfirmed = true
        case .fire(let request):
            isLoadingRetract = true
            retractError = nil
            do {
                retractResult = try await client.retract(request: request)
            } catch {
                retractResult = nil
                retractError = DaemonErrorPresenter.message(for: error)
            }
            retractConfirmed = false
            isLoadingRetract = false
        }
    }

    private func fetchAll() async {
        // Resolve identity + capabilities + projects first so the active
        // project id is up to date before the project-scoped fetches
        // fan out. Without this, the very first poll after launch would
        // send `?projectId=` empty (default project) while the operator
        // had previously selected a non-default one.
        let identityResult: Result<ClientIdentity, Error>
        do { identityResult = .success(try await client.fetchIdentity()) }
        catch { identityResult = .failure(error) }

        switch identityResult {
        case .success(let id):
            identity = id
            lastIdentityProbe = .ok(id)
            reconcileActiveProjectId(with: id.projects)
        case .failure(let error):
            identity = nil
            lastIdentityProbe = classifyIdentityFailure(error)
            activeProjectId = nil
        }

        let scopedId = activeProjectId

        async let statusResult: Result<DaemonStatusResponse, Error> = {
            do { return .success(try await client.fetchStatus(projectId: scopedId)) }
            catch { return .failure(error) }
        }()
        async let approvalsResult: Result<ApprovalsResponse, Error> = {
            do { return .success(try await client.fetchApprovals()) }
            catch { return .failure(error) }
        }()
        async let ownerQuestionsResult: Result<OwnerQuestionsResponse, Error> = {
            do { return .success(try await client.fetchOwnerQuestions()) }
            catch { return .failure(error) }
        }()
        async let tasksResult: Result<TaskQueueResponse, Error> = {
            do { return .success(try await client.fetchTasks()) }
            catch { return .failure(error) }
        }()
        async let sessionsResult: Result<SessionsResponse, Error> = {
            do { return .success(try await client.fetchSessions(projectId: scopedId)) }
            catch { return .failure(error) }
        }()
        async let recentRunsResult: Result<RunHistoryResponse, Error> = {
            do { return .success(try await client.fetchRecentRuns(projectId: scopedId)) }
            catch { return .failure(error) }
        }()
        async let capabilitiesResult: Result<CapabilityReadinessResponse, Error> = {
            do { return .success(try await client.fetchCapabilities()) }
            catch { return .failure(error) }
        }()
        async let definitionsResult: Result<WorkflowDefinitionsResponse, Error> = {
            do { return .success(try await client.fetchWorkflowDefinitions(projectId: scopedId)) }
            catch { return .failure(error) }
        }()

        let (sr, ar, oqr, tr, sesr, rrr) = await (statusResult, approvalsResult, ownerQuestionsResult, tasksResult, sessionsResult, recentRunsResult)
        let (capr, defsr) = await (capabilitiesResult, definitionsResult)
        switch capr {
        case .success(let caps): capabilities = caps
        case .failure: capabilities = nil
        }
        switch defsr {
        case .success(let resp): workflowDefinitions = resp.definitions
        case .failure: workflowDefinitions = []
        }

        switch sr {
        case .success(let status):
            let workflow = status.workflow
            let runs = status.workflow?.activeRuns ?? []
            activeRuns = runs
            if workflow?.paused == true {
                health = .paused(workflow?.queuedRunCount ?? 0)
            } else {
                health = runs.isEmpty ? .idle : .running(runs.count)
            }
        case .failure(let error):
            health = .error(DaemonErrorPresenter.message(for: error))
            activeRuns = []
            clearOnDemandForOffline()
        }

        switch ar {
        case .success(let resp):
            pendingApprovals = resp.approvals.filter { $0.status == "pending" }
        case .failure:
            pendingApprovals = []
        }

        switch oqr {
        case .success(let resp):
            pendingOwnerQuestions = resp.questions.filter { $0.status == "pending" }
        case .failure:
            pendingOwnerQuestions = []
        }

        switch tr {
        case .success(let resp):
            taskQueue = resp
        case .failure:
            taskQueue = nil
        }

        switch sesr {
        case .success(let resp):
            activeSessions = resp.sessions
        case .failure:
            activeSessions = []
        }

        switch rrr {
        case .success(let resp):
            recentRuns = resp.runs
        case .failure:
            recentRuns = []
        }

        checkForNotifications()
    }

    func checkForNotifications() {
        guard notificationsEnabled && !isPopoverOpen else {
            // Seed known state so we don't fire stale notifications when re-enabled
            if !notificationStateInitialized {
                knownFailedRunIDs = Set(recentRuns.filter { $0.status == "failed" }.map { $0.id })
                knownApprovalIDs = Set(pendingApprovals.map { $0.id })
                knownOwnerQuestionIDs = Set(pendingOwnerQuestions.map { $0.id })
                notificationStateInitialized = true
            }
            return
        }

        let currentFailedIDs = Set(recentRuns.filter { $0.status == "failed" }.map { $0.id })
        let currentApprovalIDs = Set(pendingApprovals.map { $0.id })
        let currentOwnerQuestionIDs = Set(pendingOwnerQuestions.map { $0.id })

        if notificationStateInitialized {
            for id in currentFailedIDs.subtracting(knownFailedRunIDs) {
                if let run = recentRuns.first(where: { $0.id == id }) {
                    notifications.notify(
                        title: "Workflow failed",
                        body: run.workflow,
                        identifier: "workflow-failure-\(id)"
                    )
                }
            }
            for id in currentApprovalIDs.subtracting(knownApprovalIDs) {
                if let approval = pendingApprovals.first(where: { $0.id == id }) {
                    let excerpt = approval.reason.flatMap { $0.isEmpty ? nil : String($0.prefix(100)) }
                    let body = excerpt.map { "\(approval.tool): \($0)" } ?? approval.tool
                    notifications.notify(
                        title: "Approval needed",
                        body: body,
                        identifier: "approval-\(id)"
                    )
                }
            }
            for id in currentOwnerQuestionIDs.subtracting(knownOwnerQuestionIDs) {
                if let question = pendingOwnerQuestions.first(where: { $0.id == id }) {
                    notifications.notify(
                        title: "Owner question",
                        body: "\(question.source): \(String(question.question.prefix(100)))",
                        identifier: "owner-question-\(id)"
                    )
                }
            }
        }

        knownFailedRunIDs = currentFailedIDs
        knownApprovalIDs = currentApprovalIDs
        knownOwnerQuestionIDs = currentOwnerQuestionIDs
        notificationStateInitialized = true
    }

    func approve(id: String) async {
        try? await client.approve(id: id)
        await refresh()
    }

    func reject(id: String) async {
        try? await client.reject(id: id)
        await refresh()
    }

    func answerOwnerQuestion(id: String, answer: String) async {
        try? await client.answerOwnerQuestion(id: id, answer: answer)
        await refresh()
    }

    func dismissOwnerQuestion(id: String, reason: String? = nil) async {
        try? await client.dismissOwnerQuestion(id: id, reason: reason)
        await refresh()
    }

    func triggerWorkflow(name: String, payload: Data? = nil) async throws {
        _ = try await client.triggerWorkflow(name: name, payload: payload, projectId: activeProjectId)
        await refresh()
    }

    func createSession(autonomyMode: AutonomyMode? = nil) async -> String? {
        return try? await client.createSession(autonomyMode: autonomyMode, projectId: activeProjectId)
    }

    func endSession(_ id: String) async {
        try? await client.deleteSession(id: id, projectId: activeProjectId)
        await refresh()
    }

    func setSessionAutonomyMode(id: String, mode: AutonomyMode) async {
        _ = try? await client.setSessionAutonomyMode(id: id, mode: mode, projectId: activeProjectId)
        await refresh()
    }

    /// Reseed `activeProjectId` from the latest registry projection.
    /// Reused by the polling loop and by tests that drive the registry
    /// directly. Mirrors the web `ProjectProvider` behavior — preserves
    /// an existing valid selection, falls back to `defaultProjectId`
    /// when the prior selection is no longer in the registry.
    func reconcileActiveProjectId(with projection: ProjectRegistryProjection) {
        let knownIds = Set(projection.projects.map { $0.projectId })
        if let current = activeProjectId, knownIds.contains(current) { return }
        activeProjectId = projection.defaultProjectId
    }

    public func openDashboard() {
        guard let url = webUIURL else { return }
        platform.openURL(url)
    }

    func pauseWorkflowDispatch() async {
        do {
            _ = try await client.pauseWorkflow(projectId: activeProjectId)
            await refresh()
        } catch {
            health = .error(DaemonErrorPresenter.message(for: error))
        }
    }

    func resumeWorkflowDispatch() async {
        do {
            _ = try await client.resumeWorkflow(projectId: activeProjectId)
            await refresh()
        } catch {
            health = .error(DaemonErrorPresenter.message(for: error))
        }
    }

    public func promptForProjectDirectory() async {
        if let url = await platform.pickProjectDirectory() {
            projectDir = url
            startPolling()
        }
    }
}
