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

private struct UiSurfaceSubscription {
    var eventTypes: Set<String> = []
    var streamIdsByEvent: [String: Set<String>] = [:]
}

private func uiSurfaceSubscription(_ bundle: UiSurfaceBundle) -> UiSurfaceSubscription {
    var subscription = UiSurfaceSubscription()
    for surface in bundle.surfaces {
        subscription.eventTypes.formUnion(surface.refreshEvents ?? [])
        collectUiSurfaceStreams(surface.nodes, subscription: &subscription)
    }
    return subscription
}

private func collectUiSurfaceStreams(
    _ nodes: [UiNode],
    subscription: inout UiSurfaceSubscription
) {
    for node in nodes {
        switch node {
        case .tabs(_, let tabs, _):
            for tab in tabs {
                collectUiSurfaceStreams(tab.nodes, subscription: &subscription)
            }
        case .logStream(_, let source, let streamId, _):
            subscription.eventTypes.formUnion(source.eventTypes)
            for eventType in source.eventTypes {
                subscription.streamIdsByEvent[eventType, default: []].insert(streamId)
            }
        case .navigation, .statusSummary, .metrics, .text, .link, .list,
             .table, .detail, .progress, .log, .form, .actionList, .command,
             .empty, .error:
            break
        }
    }
}

private extension Array {
    func appending(_ element: Element) -> [Element] {
        self + [element]
    }
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
    @Published var connection = ConnectionDomainState()
    @Published var activity = ActivityDomainState()
    @Published var content = ContentDomainState()
    @Published var sharedUi = SharedUiDomainState()

    @Published var scopeRoot: URL? {
        didSet {
            if let dir = scopeRoot {
                UserDefaults.standard.set(dir.path, forKey: "scopeDirectory")
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
    private var uiSurfaceEventTask: Task<Void, Never>?
    private var uiSurfaceSubscriptionKey = ""
    private let liveUiUpdatesEnabled: Bool
    private var refreshGeneration = 0
    private var scopeGeneration = 0

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
        self.liveUiUpdatesEnabled = startPollingOnInit
        if let stored = UserDefaults.standard.string(forKey: "scopeDirectory") {
            scopeRoot = URL(fileURLWithPath: stored)
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
        connection.identity?.dashboard.isAvailable ?? false
    }

    var isWorkflowDispatchPaused: Bool {
        connection.health.isDispatchPaused
    }

    /// Dashboard URL the operator should open. Returns nil when the
    /// daemon does not advertise a ready dashboard capability — the UI
    /// must hide the action in that case rather than constructing a URL.
    var webUIURL: URL? {
        guard let identity = connection.identity,
              case .available(let path) = identity.dashboard else {
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
            connection.health = .error("Invalid remote URL")
            connection.diagnostic = .remoteInvalidURL(input: remoteURL)
            clearOnDemandForOffline()
            connection.identity = nil
            connection.capabilities = nil
            activity.workflowDefinitions = []
            sharedUi.bundle = nil
            sharedUi.error = "Invalid remote URL"
            stopUiSurfaceEventStream()
            return
        }
        let token = keychainRead() ?? ""
        client.setRemoteConnection(url: url, token: token)
        await fetchAll()
        connection.diagnostic = deriveRemoteDaemonDiagnostic(
            remoteURL: remoteURL,
            identityProbe: lastIdentityProbe
        )
    }

    private func refreshLocal() async {
        guard let dir = scopeRoot else {
            connection.health = .offline
            connection.diagnostic = .noScope
            resetOfflineDaemonState()
            return
        }

        let controlFileState = classifyDaemonControlFile(scopeRoot: dir)
        switch controlFileState {
        case .missing, .unreadable, .stale:
            connection.health = .offline
            connection.diagnostic = deriveLocalDaemonDiagnostic(
                selectedScopeRoot: dir,
                controlFileState: controlFileState,
                identityProbe: nil
            )
            resetOfflineDaemonState()
            return
        case .fresh:
            break
        }

        let connected = client.refreshConnection(scopeRoot: dir)
        guard connected else {
            // The control file went away (or became unreadable) between the
            // classification above and the connection refresh — fall through
            // to the same offline rendering instead of pretending we tried.
            connection.health = .offline
            connection.diagnostic = deriveLocalDaemonDiagnostic(
                selectedScopeRoot: dir,
                controlFileState: classifyDaemonControlFile(scopeRoot: dir),
                identityProbe: nil
            )
            resetOfflineDaemonState()
            return
        }

        await fetchAll()
        connection.diagnostic = deriveLocalDaemonDiagnostic(
            selectedScopeRoot: dir,
            controlFileState: controlFileState,
            identityProbe: lastIdentityProbe
        )
    }

    private func resetOfflineDaemonState() {
        refreshGeneration += 1
        scopeGeneration += 1
        activity.clear()
        connection.identity = nil
        connection.capabilities = nil
        sharedUi.clear()
        stopUiSurfaceEventStream()
        connection.activeScopeId = nil
        lastIdentityProbe = nil
        clearOnDemandForOffline()
    }

    /// Switch the active directory scope. The selector only passes ids backed
    /// by a directory, so an unknown or non-directory id is a programming
    /// error, not a runtime fallback. Switching clears scope-bound
    /// runtime state immediately so a stale row can never paint the
    /// new scope's view, then triggers an immediate refresh.
    public func setActiveScopeId(_ scopeId: String) {
        guard let identity = connection.identity,
              identity.scopeRegistry.scopes.contains(where: {
                  $0.scopeId == scopeId && $0.directoryRoot != nil
              })
        else {
            assertionFailure("setActiveScopeId(\(scopeId)): not a directory-backed scope")
            return
        }
        guard scopeId != connection.activeScopeId else { return }
        refreshGeneration += 1
        scopeGeneration += 1
        connection.activeScopeId = scopeId
        activity.clearScopeOwned()
        content.clearLiveResults()
        sharedUi.clear()
        stopUiSurfaceEventStream()
        Task { await refresh() }
    }

    /// Drops any cached on-demand body (content.digest, content.attention) when the daemon
    /// transitions offline so a stale rollup never paints over a disconnected
    /// state. These bodies are only loaded explicitly, so the next load
    /// happens once the daemon is reachable again.
    private func clearOnDemandForOffline() {
        content.clearLiveResults()
    }

    /// Pulls the on-demand 24h rollup from `/api/digest`. Errors land in
    /// `content.digestError` so the view can surface the daemon's typed failure
    /// without preserving a stale body.
    func loadDigest() async {
        content.isLoadingDigest = true
        content.digestError = nil
        do {
            content.digest = try await client.fetchDigest()
        } catch {
            content.digest = nil
            content.digestError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingDigest = false
    }

    /// Pulls the on-demand attention rollup from `/api/attention`. Mirrors
    /// `loadDigest`: failures land in `content.attentionError` rather than silently
    /// folding back to the content.digest body.
    func loadAttention() async {
        content.isLoadingAttention = true
        content.attentionError = nil
        do {
            content.attention = try await client.fetchAttention()
        } catch {
            content.attention = nil
            content.attentionError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingAttention = false
    }

    /// Pulls semantic knowledge search results from `/api/knowledge/search`.
    /// Empty / whitespace-only queries clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `content.knowledgeError`; the typed `semanticUnavailable` branch lands
    /// in `content.knowledgeResult` so the view renders the daemon's explanation
    /// without retrying the request.
    func loadKnowledge() async {
        let trimmed = content.knowledgeQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            content.knowledgeResult = nil
            content.knowledgeError = nil
            content.isLoadingKnowledge = false
            return
        }
        content.isLoadingKnowledge = true
        content.knowledgeError = nil
        do {
            content.knowledgeResult = try await client.searchKnowledge(query: trimmed, limit: 10)
        } catch {
            content.knowledgeResult = nil
            content.knowledgeError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingKnowledge = false
    }

    /// Pulls semantic memory search results from `/api/memory/search`.
    /// Empty / whitespace-only queries clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `content.memoryError`; the typed `semanticUnavailable` branch lands in
    /// `content.memoryResult` so the view renders the daemon's explanation without
    /// retrying the request.
    func loadMemory() async {
        let trimmed = content.memoryQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            content.memoryResult = nil
            content.memoryError = nil
            content.isLoadingMemory = false
            return
        }
        content.isLoadingMemory = true
        content.memoryError = nil
        do {
            content.memoryResult = try await client.searchMemory(query: trimmed, limit: 10)
        } catch {
            content.memoryResult = nil
            content.memoryError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingMemory = false
    }

    /// Pulls semantic history search results from `/api/history/search`.
    /// Empty / whitespace-only queries clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `content.historyError`; the typed `semanticUnavailable` branch lands in
    /// `content.historyResult` so the view renders the daemon's explanation without
    /// retrying the request.
    func loadHistory() async {
        let trimmed = content.historyQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            content.historyResult = nil
            content.historyError = nil
            content.isLoadingHistory = false
            return
        }
        content.isLoadingHistory = true
        content.historyError = nil
        do {
            content.historyResult = try await client.searchHistory(query: trimmed, limit: 10)
        } catch {
            content.historyResult = nil
            content.historyError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingHistory = false
    }

    /// Pulls semantic repo-task search results from the daemon's
    /// `/tasks/search` route. Empty / whitespace-only queries clear any prior
    /// result and skip the request — the view surfaces the inline usage hint
    /// instead. Failures land in `content.tasksError`; the typed `semanticUnavailable`
    /// branch lands in `content.tasksResult` so the view renders the daemon's
    /// explanation without retrying the request.
    func loadTasksSearch() async {
        let trimmed = content.tasksQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            content.tasksResult = nil
            content.tasksError = nil
            content.isLoadingTasksSearch = false
            return
        }
        content.isLoadingTasksSearch = true
        content.tasksError = nil
        do {
            content.tasksResult = try await client.searchTasks(query: trimmed, limit: 10, states: nil)
        } catch {
            content.tasksResult = nil
            content.tasksError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingTasksSearch = false
    }

    /// Pulls cross-store recall results from the daemon's `POST /recall`
    /// route. Empty / whitespace-only queries clear any prior result and skip
    /// the request — the view surfaces the inline usage hint instead. Failures
    /// land in `content.recallError`; the typed `semanticUnavailable` branch lands in
    /// `content.recallResult` so the view renders the daemon's explanation without
    /// retrying the request. `topK`, `minScore`, and `sources` are left nil so
    /// the seam applies its own typed defaults (every registered contributor,
    /// `RECALL_DEFAULT_TOP_K = 20`, no min-score floor).
    func loadRecall() async {
        let trimmed = content.recallQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            content.recallResult = nil
            content.recallError = nil
            content.isLoadingRecall = false
            return
        }
        content.isLoadingRecall = true
        content.recallError = nil
        do {
            content.recallResult = try await client.recall(
                query: trimmed,
                topK: nil,
                minScore: nil,
                sources: nil
            )
        } catch {
            content.recallResult = nil
            content.recallError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingRecall = false
    }

    /// Pulls a synthesized cited answer from the daemon's `POST /answer`
    /// route. Empty / whitespace-only queries clear any prior result and
    /// skip the request — the view surfaces the inline usage hint instead.
    /// Failures land in `content.answerError`; the three typed `ok: false` arms
    /// (`noHits`, `semanticUnavailable`, `synthesisFailed`) land in
    /// `content.answerResult` so the view renders the daemon's degradation notice
    /// without retrying the request. `topK`, `minScore`, and `sources`
    /// are left nil so the seam applies its own typed defaults.
    func loadAnswer() async {
        let trimmed = content.answerQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            content.answerResult = nil
            content.answerError = nil
            content.isLoadingAnswer = false
            return
        }
        content.isLoadingAnswer = true
        content.answerError = nil
        do {
            content.answerResult = try await client.answer(
                query: trimmed,
                topK: nil,
                minScore: nil,
                sources: nil
            )
        } catch {
            content.answerResult = nil
            content.answerError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingAnswer = false
    }

    /// Page size for the persisted answer-history list. Mirrors the
    /// mobile `ANSWER_LOG_PAGE_SIZE` so a paginated request returns the
    /// same row count on every operator surface, and the
    /// `entries.count >= limit` heuristic the daemon's list route exposes
    /// translates to the same `content.answerLogHasMore` truth value.
    static let answerLogPageSize: Int = 20

    /// Pulls the persisted cited-answer history from the daemon's
    /// `GET /answers` daemon-control route. The first call clears any
    /// prior list, error, or open-detail state. A `beforeId` cursor
    /// appends to the existing list instead of resetting, mirroring the
    /// mobile `loadAnswerLog({ beforeId })` paginate path. Failures land
    /// in `content.answerLogError`; successful loads update `content.answerLogHasMore`
    /// from the cursor heuristic (`entries.count >= limit`).
    func loadAnswerLog(beforeId: String? = nil) async {
        let append = beforeId != nil
        content.isLoadingAnswerLog = true
        content.answerLogError = nil
        if !append {
            content.answerShowOpenId = nil
            content.answerShowRecord = nil
            content.answerShowMissing = false
            content.answerShowError = nil
            content.isLoadingAnswerShow = false
        }
        let limit = AppState.answerLogPageSize
        do {
            let result = try await client.answerLog(
                filter: AnswerHistoryListFilter(limit: limit, beforeId: beforeId)
            )
            if append {
                content.answerLogEntries.append(contentsOf: result.entries)
            } else {
                content.answerLogEntries = result.entries
            }
            content.answerLogHasMore = result.entries.count >= limit
        } catch {
            content.answerLogError = DaemonErrorPresenter.message(for: error)
            content.answerLogHasMore = false
        }
        content.isLoadingAnswerLog = false
    }

    /// Cursor paginate. Reads the last entry's id and asks the daemon for
    /// the next page before it. A no-op when the list is empty (which
    /// also keeps `content.answerLogHasMore` honest after a refresh).
    func loadMoreAnswerLog() async {
        guard let last = content.answerLogEntries.last else { return }
        await loadAnswerLog(beforeId: last.id)
    }

    /// Pulls the full persisted envelope for one record from the daemon's
    /// `GET /answers/:id` route. Sets `content.answerShowOpenId` so the view can
    /// pin which row the operator opened, and folds the discriminated
    /// `AnswerHistoryShowResult` into typed view state: `notFound` lands
    /// in `content.answerShowMissing` (the typed banner), `success` lands in
    /// `content.answerShowRecord`. Transport / decode failures land in
    /// `content.answerShowError`.
    func openAnswerShow(id: String) async {
        content.answerShowOpenId = id
        content.answerShowRecord = nil
        content.answerShowMissing = false
        content.answerShowError = nil
        content.isLoadingAnswerShow = true
        do {
            let result = try await client.answerShow(id: id)
            switch result {
            case .success(let record):
                content.answerShowRecord = record
                content.answerShowMissing = false
            case .notFound:
                content.answerShowRecord = nil
                content.answerShowMissing = true
            }
        } catch {
            content.answerShowRecord = nil
            content.answerShowMissing = false
            content.answerShowError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingAnswerShow = false
    }

    /// Drops any open answer-history detail state without touching the
    /// list. Mirrors mobile's `closeAnswerShow` so the operator can
    /// collapse the detail back to the list view from the macOS surface
    /// without re-loading the list.
    func closeAnswerShow() {
        content.answerShowOpenId = nil
        content.answerShowRecord = nil
        content.answerShowMissing = false
        content.answerShowError = nil
        content.isLoadingAnswerShow = false
    }

    /// Posts the current draft through the daemon's `POST /capture` route.
    /// Empty / whitespace-only drafts clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead. Failures
    /// land in `content.captureError`; the four typed `CaptureResult` arms
    /// (`success`, `ambiguous`, `noContributors`, `contributorFailed`) all
    /// land in `content.captureResult` so the view renders the daemon's verdict
    /// without retrying the request. The `content.captureTarget` picker collapses
    /// `.auto` to a `nil` target so the seam classifier picks the store;
    /// `content.captureHint` collapses an empty string to `nil` so the daemon
    /// skips passing the hint to the prompt.
    func loadCapture() async {
        let trimmed = content.captureDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            content.captureResult = nil
            content.captureError = nil
            content.isLoadingCapture = false
            return
        }
        content.isLoadingCapture = true
        content.captureError = nil
        let trimmedHint = content.captureHint.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedHint: String? = trimmedHint.isEmpty ? nil : trimmedHint
        do {
            content.captureResult = try await client.capture(
                text: trimmed,
                target: content.captureTarget.resolved,
                hint: resolvedHint
            )
        } catch {
            content.captureResult = nil
            content.captureError = DaemonErrorPresenter.message(for: error)
        }
        content.isLoadingCapture = false
    }

    /// Posts the current retract draft through the daemon's
    /// `POST /retract` route. Submission is gated through the pure
    /// `evaluateRetractSubmit` helper so the gate is unit-testable
    /// without instantiating `AppState`. The first call with a non-empty
    /// identifier flips `content.retractConfirmed` and returns without firing,
    /// mirroring how `RetractPanel.tsx` already gates the dashboard
    /// surface against the seam's `dangerous` risk classification. The
    /// second call (once the operator has acknowledged) builds the typed
    /// `RetractRequest` from the picker + identifier draft and consumes
    /// `DaemonClient.retract`. Failures land in `content.retractError`; the four
    /// typed `RetractResult` arms (`success`, `noContributors`,
    /// `notFound`, `contributorFailed`) all land in `content.retractResult` so
    /// the view renders the daemon's verdict without retrying. Empty /
    /// whitespace identifiers clear any prior result and skip the
    /// request — the view surfaces the inline usage hint instead.
    func loadRetract() async {
        let outcome = evaluateRetractSubmit(
            target: content.retractTarget,
            identifier: content.retractIdentifier,
            confirmed: content.retractConfirmed
        )
        switch outcome {
        case .skip:
            content.retractResult = nil
            content.retractError = nil
            content.retractConfirmed = false
            content.isLoadingRetract = false
        case .requireConfirmation:
            content.retractConfirmed = true
        case .fire(let request):
            content.isLoadingRetract = true
            content.retractError = nil
            do {
                content.retractResult = try await client.retract(request: request)
            } catch {
                content.retractResult = nil
                content.retractError = DaemonErrorPresenter.message(for: error)
            }
            content.retractConfirmed = false
            content.isLoadingRetract = false
        }
    }

    private func fetchAll() async {
        refreshGeneration += 1
        let requestGeneration = refreshGeneration
        // Resolve connection.identity and connection.capabilities first so the active directory
        // scope is up to date before scope-aware fetches
        // fan out. Without this, the very first poll after launch would
        // send `?scopeId=` empty (the default scope) while the operator
        // had previously selected a non-default one.
        let identityResult: Result<ClientIdentity, Error>
        do { identityResult = .success(try await client.fetchIdentity()) }
        catch { identityResult = .failure(error) }

        guard requestGeneration == refreshGeneration else { return }

        switch identityResult {
        case .success(let id):
            connection.identity = id
            lastIdentityProbe = .ok(id)
            reconcileActiveScopeId(with: id.scopeRegistry)
        case .failure(let error):
            connection.identity = nil
            lastIdentityProbe = classifyIdentityFailure(error)
            connection.activeScopeId = nil
        }

        let scopedId = connection.activeScopeId
        let requestScopeGeneration = scopeGeneration

        async let statusResult: Result<DaemonStatusResponse, Error> = {
            do { return .success(try await client.fetchStatus(scopeId: scopedId)) }
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
        async let taskQueueResult: Result<TaskQueueResponse, Error> = {
            do { return .success(try await client.fetchTasks()) }
            catch { return .failure(error) }
        }()
        async let sessionsResult: Result<SessionsResponse, Error> = {
            do { return .success(try await client.fetchSessions(scopeId: scopedId)) }
            catch { return .failure(error) }
        }()
        async let recentRunsResult: Result<RunHistoryResponse, Error> = {
            do { return .success(try await client.fetchRecentRuns(scopeId: scopedId)) }
            catch { return .failure(error) }
        }()
        async let capabilitiesResult: Result<CapabilityReadinessResponse, Error> = {
            do { return .success(try await client.fetchCapabilities()) }
            catch { return .failure(error) }
        }()
        async let definitionsResult: Result<WorkflowDefinitionsResponse, Error> = {
            do { return .success(try await client.fetchWorkflowDefinitions(scopeId: scopedId)) }
            catch { return .failure(error) }
        }()
        async let surfacesResult: Result<UiSurfaceBundle, Error> = {
            do { return .success(try await client.fetchUiSurfaceBundle(scopeId: scopedId)) }
            catch { return .failure(error) }
        }()

        let (sr, ar, oqr, tr, sesr, rrr) = await (statusResult, approvalsResult, ownerQuestionsResult, taskQueueResult, sessionsResult, recentRunsResult)
        let (capr, defsr, uisr) = await (capabilitiesResult, definitionsResult, surfacesResult)
        guard requestGeneration == refreshGeneration,
              requestScopeGeneration == scopeGeneration
        else { return }
        switch capr {
        case .success(let caps): connection.capabilities = caps
        case .failure: connection.capabilities = nil
        }
        switch defsr {
        case .success(let resp): activity.workflowDefinitions = resp.definitions
        case .failure: activity.workflowDefinitions = []
        }
        switch uisr {
        case .success(let bundle):
            applyUiSurfaceBundle(bundle)
        case .failure(let error):
            sharedUi.bundle = nil
            sharedUi.error = DaemonErrorPresenter.message(for: error)
            stopUiSurfaceEventStream()
        }

        switch sr {
        case .success(let status):
            let workflow = status.workflow
            let runs = status.workflow?.activeRuns ?? []
            activity.activeRuns = runs
            if workflow?.paused == true {
                connection.health = .paused(workflow?.queuedRunCount ?? 0)
            } else {
                connection.health = runs.isEmpty ? .idle : .running(runs.count)
            }
        case .failure(let error):
            connection.health = .error(DaemonErrorPresenter.message(for: error))
            activity.activeRuns = []
            clearOnDemandForOffline()
        }

        switch ar {
        case .success(let resp):
            activity.pendingApprovals = resp.approvals.filter { $0.status == "pending" }
        case .failure:
            activity.pendingApprovals = []
        }

        switch oqr {
        case .success(let resp):
            activity.pendingOwnerQuestions = resp.questions.filter { $0.status == "pending" }
        case .failure:
            activity.pendingOwnerQuestions = []
        }

        switch tr {
        case .success(let resp):
            activity.taskQueue = resp
        case .failure:
            activity.taskQueue = nil
        }

        switch sesr {
        case .success(let resp):
            activity.activeSessions = resp.sessions
        case .failure:
            activity.activeSessions = []
        }

        switch rrr {
        case .success(let resp):
            activity.recentRuns = resp.runs
        case .failure:
            activity.recentRuns = []
        }

        checkForNotifications()
    }

    // MARK: - Shared UI surface runtime

    func refreshUiSurfaceBundle() async {
        sharedUi.isLoading = true
        do {
            let bundle = try await client.fetchUiSurfaceBundle(scopeId: connection.activeScopeId)
            applyUiSurfaceBundle(bundle)
        } catch {
            sharedUi.error = DaemonErrorPresenter.message(for: error)
            sharedUi.isLoading = false
        }
    }

    func executeUiAction(
        _ action: UiAction,
        parameters: [String: UiJsonValue]? = nil
    ) async -> UiActionExecutionResult {
        let result: UiActionExecutionResult
        do {
            result = try await client.executeUiAction(action, parameters: parameters)
        } catch {
            result = UiActionExecutionResult(
                ok: false,
                reason: "transport-error",
                message: DaemonErrorPresenter.message(for: error)
            )
        }
        if result.ok {
            await refreshUiSurfaceBundle()
        }
        return result
    }

    @discardableResult
    func openUiLinkTarget(_ target: UiLinkTarget) -> Bool {
        let url: URL?
        switch target {
        case .daemonRoute(let path):
            url = client.absoluteUiURL(path: path)
        case .externalUrl(let rawURL):
            url = URL(string: rawURL)
        case .surface, .session:
            url = nil
        }
        return url.map(platform.openURL) ?? false
    }

    func pickUiPath() async -> URL? {
        await platform.pickScopeDirectory()
    }

    private func applyUiSurfaceBundle(_ bundle: UiSurfaceBundle) {
        sharedUi.bundle = bundle
        sharedUi.error = nil
        sharedUi.isLoading = false
        reconcileUiSurfaceEventStream(bundle: bundle)
    }

    private func reconcileUiSurfaceEventStream(bundle: UiSurfaceBundle) {
        guard liveUiUpdatesEnabled else { return }
        let subscription = uiSurfaceSubscription(bundle)
        let key = subscription.eventTypes.sorted().joined(separator: "\u{1f}")
        guard !subscription.eventTypes.isEmpty else {
            stopUiSurfaceEventStream()
            return
        }
        guard key != uiSurfaceSubscriptionKey else { return }
        stopUiSurfaceEventStream()
        uiSurfaceSubscriptionKey = key
        uiSurfaceEventTask = Task { [weak self] in
            guard let self else { return }
            self.sharedUi.eventsConnected = true
            do {
                try await self.client.watchUiSurfaceEvents(
                    eventTypes: subscription.eventTypes
                ) { [weak self] event in
                    await self?.consumeUiSurfaceEvent(event)
                }
            } catch is CancellationError {
                // A scope or subscription change owns cancellation.
            } catch {
                // Polling remains the reconnect fallback. Keep the decoded
                // bundle visible and expose disconnected live state natively.
            }
            if self.uiSurfaceSubscriptionKey == key {
                self.uiSurfaceSubscriptionKey = ""
                self.sharedUi.eventsConnected = false
            }
        }
    }

    private func consumeUiSurfaceEvent(_ event: UiSurfaceLiveEvent) async {
        guard let bundle = sharedUi.bundle else { return }
        let subscription = uiSurfaceSubscription(bundle)
        for streamId in subscription.streamIdsByEvent[event.type] ?? [] {
            let entry = UiLogEntry(
                level: event.level,
                message: event.message,
                source: event.type,
                timestamp: event.timestamp
            )
            sharedUi.liveLogEntries[streamId] = Array(
                (sharedUi.liveLogEntries[streamId] ?? []).appending(entry).suffix(100)
            )
        }
        await refreshUiSurfaceBundle()
    }

    private func stopUiSurfaceEventStream() {
        uiSurfaceEventTask?.cancel()
        uiSurfaceEventTask = nil
        uiSurfaceSubscriptionKey = ""
        sharedUi.eventsConnected = false
    }

    func checkForNotifications() {
        guard notificationsEnabled && !isPopoverOpen else {
            // Seed known state so we don't fire stale notifications when re-enabled
            if !notificationStateInitialized {
                knownFailedRunIDs = Set(activity.recentRuns.filter { $0.status == "failed" }.map { $0.id })
                knownApprovalIDs = Set(activity.pendingApprovals.map { $0.id })
                knownOwnerQuestionIDs = Set(activity.pendingOwnerQuestions.map { $0.id })
                notificationStateInitialized = true
            }
            return
        }

        let currentFailedIDs = Set(activity.recentRuns.filter { $0.status == "failed" }.map { $0.id })
        let currentApprovalIDs = Set(activity.pendingApprovals.map { $0.id })
        let currentOwnerQuestionIDs = Set(activity.pendingOwnerQuestions.map { $0.id })

        if notificationStateInitialized {
            for id in currentFailedIDs.subtracting(knownFailedRunIDs) {
                if let run = activity.recentRuns.first(where: { $0.id == id }) {
                    notifications.notify(
                        title: "Workflow failed",
                        body: run.workflow,
                        identifier: "workflow-failure-\(id)"
                    )
                }
            }
            for id in currentApprovalIDs.subtracting(knownApprovalIDs) {
                if let approval = activity.pendingApprovals.first(where: { $0.id == id }) {
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
                if let question = activity.pendingOwnerQuestions.first(where: { $0.id == id }) {
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

    func approve(id: String, reviewDigest: String) async {
        try? await client.approve(id: id, reviewDigest: reviewDigest)
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
        _ = try await client.triggerWorkflow(name: name, payload: payload, scopeId: connection.activeScopeId)
        await refresh()
    }

    func createSession(autonomyMode: AutonomyMode? = nil) async -> String? {
        return try? await client.createSession(autonomyMode: autonomyMode, scopeId: connection.activeScopeId)
    }

    func endSession(_ id: String) async {
        try? await client.deleteSession(id: id, scopeId: connection.activeScopeId)
        await refresh()
    }

    func setSessionAutonomyMode(id: String, mode: AutonomyMode) async {
        _ = try? await client.setSessionAutonomyMode(id: id, mode: mode, scopeId: connection.activeScopeId)
        await refresh()
    }

    /// Reseed `connection.activeScopeId` from the latest registry projection.
    /// Reused by the polling loop and by tests that drive the registry
    /// directly. Mirrors the web `ScopeProvider` behavior — preserves
    /// an existing valid selection, falls back to `defaultScopeId`
    /// when the prior selection is no longer in the registry.
    func reconcileActiveScopeId(with projection: ScopeRegistryProjection) {
        let directoryScopeIds = Set(
            projection.scopes.compactMap { $0.directoryRoot == nil ? nil : $0.scopeId }
        )
        if let current = connection.activeScopeId, directoryScopeIds.contains(current) { return }
        let nextScopeId = directoryScopeIds.contains(projection.defaultScopeId)
            ? projection.defaultScopeId
            : directoryScopeIds.first
        guard nextScopeId != connection.activeScopeId else { return }
        scopeGeneration += 1
        connection.activeScopeId = nextScopeId
        activity.clearScopeOwned()
        content.clearLiveResults()
        sharedUi.clear()
        stopUiSurfaceEventStream()
    }

    public func openDashboard() {
        guard let url = webUIURL else { return }
        platform.openURL(url)
    }

    func pauseWorkflowDispatch() async {
        do {
            _ = try await client.pauseWorkflow(scopeId: connection.activeScopeId)
            await refresh()
        } catch {
            connection.health = .error(DaemonErrorPresenter.message(for: error))
        }
    }

    func resumeWorkflowDispatch() async {
        do {
            _ = try await client.resumeWorkflow(scopeId: connection.activeScopeId)
            await refresh()
        } catch {
            connection.health = .error(DaemonErrorPresenter.message(for: error))
        }
    }

    public func promptForScopeDirectory() async {
        if let url = await platform.pickScopeDirectory() {
            scopeRoot = url
            startPolling()
        }
    }
}
