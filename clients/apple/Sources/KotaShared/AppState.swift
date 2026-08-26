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

private struct DaemonRequestToken: Equatable {
    let generation: Int
    let source: DaemonRequestSource
}

// MARK: - AppState

@MainActor
public final class AppState: ObservableObject {
    @Published var health: DaemonHealth = .unknown
    @Published var activeRuns: [ActiveRun] = []
    @Published var pendingApprovals: [ApprovalRequest] = []
    @Published var pendingOwnerQuestions: [OwnerQuestion] = []
    @Published var recentRuns: [RunSummary] = []
    @Published var identity: ClientIdentity?

    // Canonical daemon-owned operator UI rendered by both Apple shells.
    @Published var uiSurfaceBundle: UiSurfaceBundle?
    @Published var uiSurfaceError: String?
    @Published var isLoadingUiSurfaces = false
    @Published var uiSurfaceEventsConnected = false
    @Published var liveUiLogEntries: [String: [UiLogEntry]] = [:]

    /// Active scope id used to scope every scope-scoped daemon route
    /// (`/status`, `/workflow/runs`, `/workflow/trigger`, `/sessions`,
    /// …). `nil` until the first identity refresh resolves the registry's
    /// default. Reseeds to `identity.scopeRegistry.defaultScopeId` if the
    /// current selection is no longer in the registry, matching the web
    /// `ScopeProvider` behavior. Operator-driven switches go through
    /// `setActiveScopeId(_:)`.
    @Published public private(set) var activeScopeId: String?

    /// Operator-facing classification of the current connection. Replaces
    /// the historical "Daemon offline" collapse with a discriminated state
    /// that names which scope, base URL, pid, and failure mode the menu
    /// bar should render. Updated on every refresh — see
    /// `deriveLocalDaemonDiagnostic` / `deriveRemoteDaemonDiagnostic`.
    @Published var diagnostic: DaemonConnectionDiagnostic = .noScope

    @Published var scopeRoot: URL? {
        didSet {
            if let dir = scopeRoot {
                UserDefaults.standard.set(dir.path, forKey: "scopeDirectory")
            }
            guard scopeRoot != oldValue else { return }
            resetOfflineDaemonState()
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
    private var uiSurfaceEventSubscription: UiSurfaceEventSubscription?
    private var uiSurfaceEventStreamID: UUID?
    private var uiSurfaceLastEventId: String?
    private var requestSource: DaemonRequestSource?
    private var requestSourceGeneration = 0
    private var uiSurfaceRefreshTask: Task<Result<UiSurfaceBundle, Error>, Never>?
    private var uiSurfaceRefreshToken: DaemonRequestToken?
    private let liveUiUpdatesEnabled: Bool

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

    var isWorkflowDispatchPaused: Bool {
        health.isDispatchPaused
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
        resetOfflineDaemonState()
        remoteURL = url
        if token.isEmpty {
            keychainDelete()
        } else {
            keychainSave(token: token)
        }
        startPolling()
    }

    func clearRemoteConfig() {
        resetOfflineDaemonState()
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
            invalidateRequestSource()
            health = .error("Invalid remote URL")
            diagnostic = .remoteInvalidURL(input: remoteURL)
            identity = nil
            uiSurfaceBundle = nil
            uiSurfaceError = "Invalid remote URL"
            stopUiSurfaceEventStream()
            return
        }
        let token = keychainRead() ?? ""
        client.setRemoteConnection(url: url, token: token)
        guard await fetchAll() else { return }
        diagnostic = deriveRemoteDaemonDiagnostic(
            remoteURL: remoteURL,
            identityProbe: lastIdentityProbe
        )
    }

    private func refreshLocal() async {
        guard let dir = scopeRoot else {
            health = .offline
            diagnostic = .noScope
            resetOfflineDaemonState()
            return
        }

        let controlFileState = classifyDaemonControlFile(scopeRoot: dir)
        switch controlFileState {
        case .missing, .unreadable, .stale:
            health = .offline
            diagnostic = deriveLocalDaemonDiagnostic(
                selectedScopeDir: dir,
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
            health = .offline
            diagnostic = deriveLocalDaemonDiagnostic(
                selectedScopeDir: dir,
                controlFileState: classifyDaemonControlFile(scopeRoot: dir),
                identityProbe: nil
            )
            resetOfflineDaemonState()
            return
        }

        guard await fetchAll() else { return }
        diagnostic = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
            controlFileState: controlFileState,
            identityProbe: lastIdentityProbe
        )
    }

    private func resetOfflineDaemonState() {
        invalidateRequestSource()
        activeRuns = []
        pendingApprovals = []
        pendingOwnerQuestions = []
        recentRuns = []
        identity = nil
        uiSurfaceBundle = nil
        uiSurfaceError = nil
        isLoadingUiSurfaces = false
        liveUiLogEntries = [:]
        stopUiSurfaceEventStream()
        activeScopeId = nil
        lastIdentityProbe = nil
    }

    /// Switch the active scope. Throws if `scopeId` is not in the
    /// current registry — the caller (scope selector view) should
    /// only ever pass a known id, so an unknown id is a programming
    /// error, not a runtime fallback. Switching clears scope-scoped
    /// runtime state immediately so a stale row can never paint the
    /// new scope's view, then triggers an immediate refresh.
    public func setActiveScopeId(_ scopeId: String) {
        guard let identity, identity.scopeRegistry.scopes.contains(where: { $0.scopeId == scopeId }) else {
            assertionFailure("setActiveScopeId(\(scopeId)): not in identity.scopeRegistry")
            return
        }
        guard scopeId != activeScopeId else { return }
        activeScopeId = scopeId
        invalidateRequestSource()
        activeRuns = []
        pendingApprovals = []
        pendingOwnerQuestions = []
        recentRuns = []
        uiSurfaceBundle = nil
        uiSurfaceError = nil
        liveUiLogEntries = [:]
        stopUiSurfaceEventStream()
        Task { await refresh() }
    }

    private func fetchAll() async -> Bool {
        // Resolve identity and scopes first so the active
        // scope id is up to date before the scope-scoped fetches
        // fan out. Without this, the very first poll after launch would
        // send `?scopeId=` empty (default scope) while the operator
        // had previously selected a non-default one.
        guard let identityToken = synchronizeRequestSource() else { return false }
        let identityResult: Result<ClientIdentity, Error>
        do { identityResult = .success(try await client.fetchIdentity()) }
        catch { identityResult = .failure(error) }
        guard isCurrent(identityToken) else { return false }

        switch identityResult {
        case .success(let id):
            identity = id
            lastIdentityProbe = .ok(id)
            reconcileActiveScopeId(with: id.scopeRegistry)
        case .failure(let error):
            identity = nil
            lastIdentityProbe = classifyIdentityFailure(error)
            activeScopeId = nil
        }

        guard let scopedToken = synchronizeRequestSource() else { return false }
        let scopedId = scopedToken.source.scopeId

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
        async let recentRunsResult: Result<RunHistoryResponse, Error> = {
            do { return .success(try await client.fetchRecentRuns(scopeId: scopedId)) }
            catch { return .failure(error) }
        }()
        async let surfacesResult: Result<UiSurfaceBundle, Error> = {
            await self.requestUiSurfaceBundle(scopedToken)
        }()

        let (sr, ar, oqr, rrr, uisr) = await (
            statusResult,
            approvalsResult,
            ownerQuestionsResult,
            recentRunsResult,
            surfacesResult
        )
        guard isCurrent(scopedToken) else { return false }
        switch uisr {
        case .success(let bundle):
            applyUiSurfaceBundle(bundle, token: scopedToken)
        case .failure(let error):
            uiSurfaceBundle = nil
            uiSurfaceError = DaemonErrorPresenter.message(for: error)
            stopUiSurfaceEventStream()
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

        switch rrr {
        case .success(let resp):
            recentRuns = resp.runs
        case .failure:
            recentRuns = []
        }

        checkForNotifications()
        return true
    }

    // MARK: - Shared UI surface runtime

    func refreshUiSurfaceBundle() async {
        guard let token = synchronizeRequestSource() else { return }
        await refreshUiSurfaceBundle(token: token)
    }

    private func refreshUiSurfaceBundle(token: DaemonRequestToken) async {
        guard isCurrent(token) else { return }
        isLoadingUiSurfaces = true
        switch await requestUiSurfaceBundle(token) {
        case .success(let bundle) where isCurrent(token):
            applyUiSurfaceBundle(bundle, token: token)
        case .failure(let error) where isCurrent(token):
            uiSurfaceError = DaemonErrorPresenter.message(for: error)
            isLoadingUiSurfaces = false
        case .success, .failure:
            break
        }
    }

    func executeUiAction(
        _ action: UiAction,
        parameters: [String: UiJsonValue]? = nil
    ) async -> UiActionExecutionResult {
        guard let token = synchronizeRequestSource(),
              action.scopeId == token.source.scopeId else {
            return UiActionExecutionResult(
                ok: false,
                reason: "source-changed",
                message: "The daemon or scope changed before this action could run.",
                payload: nil
            )
        }
        let result: UiActionExecutionResult
        do {
            result = try await client.executeUiAction(action, parameters: parameters)
        } catch {
            result = UiActionExecutionResult(
                ok: false,
                reason: "transport-error",
                message: DaemonErrorPresenter.message(for: error),
                payload: nil
            )
        }
        guard isCurrent(token) else {
            return UiActionExecutionResult(
                ok: false,
                reason: "source-changed",
                message: "The daemon or scope changed while the action was running; verify its outcome.",
                payload: nil
            )
        }
        if result.ok {
            if case .externalURL? = result.payload {
                guard openUiActionPayload(result.payload) else { return result }
                await refreshUiSurfaceBundle(token: token)
                return UiActionExecutionResult(
                    ok: result.ok,
                    reason: result.reason,
                    message: result.message,
                    payload: nil
                )
            }
            await refreshUiSurfaceBundle(token: token)
        }
        return result
    }

    @discardableResult
    func openUiActionPayload(_ payload: UiActionExecutionPayload?) -> Bool {
        guard case .externalURL(let rawURL, _) = payload,
              let url = URL(string: rawURL) else { return false }
        return platform.openURL(url)
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

    private func applyUiSurfaceBundle(_ bundle: UiSurfaceBundle, token: DaemonRequestToken) {
        guard isCurrent(token) else { return }
        uiSurfaceBundle = bundle
        uiSurfaceError = nil
        isLoadingUiSurfaces = false
        reconcileUiSurfaceEventStream(bundle: bundle, token: token)
    }

    private func reconcileUiSurfaceEventStream(bundle: UiSurfaceBundle, token: DaemonRequestToken) {
        guard liveUiUpdatesEnabled, isCurrent(token) else { return }
        guard let subscription = UiSurfaceEventSubscription(
            bundle: bundle,
            source: token.source
        ) else {
            stopUiSurfaceEventStream()
            return
        }
        guard subscription != uiSurfaceEventSubscription || uiSurfaceEventTask == nil else { return }

        let preserveCursor = subscription.source == uiSurfaceEventSubscription?.source
        stopUiSurfaceEventStream(resetCursor: !preserveCursor)
        uiSurfaceEventSubscription = subscription
        let streamID = UUID()
        uiSurfaceEventStreamID = streamID
        let cursor = uiSurfaceLastEventId
        uiSurfaceEventTask = Task { [weak self] in
            guard let self,
                  self.isCurrent(token),
                  self.uiSurfaceEventStreamID == streamID else { return }
            self.uiSurfaceEventsConnected = true
            do {
                try await self.client.watchUiSurfaceEvents(
                    eventTypes: subscription.eventTypes,
                    afterEventId: cursor
                ) { [weak self] event in
                    guard let self,
                          self.isCurrent(token),
                          self.uiSurfaceEventStreamID == streamID else { return }
                    await self.consumeUiSurfaceEvent(event, token: token, streamID: streamID)
                }
            } catch is CancellationError {
                // A scope or subscription change owns cancellation.
            } catch {
                // Polling remains the reconnect fallback. Keep the decoded
                // bundle visible and expose disconnected live state natively.
            }
            if self.isCurrent(token), self.uiSurfaceEventStreamID == streamID {
                self.uiSurfaceEventTask = nil
                self.uiSurfaceEventStreamID = nil
                self.uiSurfaceEventsConnected = false
            }
        }
    }

    private func consumeUiSurfaceEvent(
        _ event: UiSurfaceLiveEvent,
        token: DaemonRequestToken,
        streamID: UUID
    ) async {
        guard isCurrent(token), uiSurfaceEventStreamID == streamID else { return }
        guard let bundle = uiSurfaceBundle else { return }
        if let eventId = event.id { uiSurfaceLastEventId = eventId }
        let match = matchUiSurfaceEvent(bundle: bundle, event: event)
        guard match.refresh else { return }
        for streamId in match.streamIds {
            let entry = UiLogEntry(
                level: event.level,
                message: event.message,
                source: event.type,
                timestamp: event.timestamp
            )
            liveUiLogEntries[streamId] = Array(
                (liveUiLogEntries[streamId] ?? []).appending(entry).suffix(100)
            )
        }
        await refreshUiSurfaceBundle(token: token)
    }

    private func stopUiSurfaceEventStream(resetCursor: Bool = true) {
        uiSurfaceEventTask?.cancel()
        uiSurfaceEventTask = nil
        uiSurfaceEventStreamID = nil
        uiSurfaceEventSubscription = nil
        if resetCursor { uiSurfaceLastEventId = nil }
        uiSurfaceEventsConnected = false
    }

    private func synchronizeRequestSource() -> DaemonRequestToken? {
        guard let connection = client.connection else { return nil }
        let source = DaemonRequestSource(
            connection: connection,
            scopeId: activeScopeId,
            daemonPID: identity.map { Int($0.pid) },
            daemonStartedAt: identity?.startedAt
        )
        if source != requestSource {
            requestSourceGeneration += 1
            requestSource = source
            cancelUiSurfaceRefresh()
            stopUiSurfaceEventStream()
        }
        return DaemonRequestToken(generation: requestSourceGeneration, source: source)
    }

    private func isCurrent(_ token: DaemonRequestToken) -> Bool {
        token.generation == requestSourceGeneration &&
            token.source == requestSource &&
            token.source == DaemonRequestSource(
                connection: token.source.connection,
                scopeId: activeScopeId,
                daemonPID: identity.map { Int($0.pid) },
                daemonStartedAt: identity?.startedAt
            ) &&
            client.connection == token.source.connection
    }

    private func invalidateRequestSource() {
        requestSourceGeneration += 1
        requestSource = nil
        cancelUiSurfaceRefresh()
        stopUiSurfaceEventStream()
    }

    private func requestUiSurfaceBundle(
        _ token: DaemonRequestToken
    ) async -> Result<UiSurfaceBundle, Error> {
        guard isCurrent(token) else {
            return .failure(CancellationError())
        }
        if uiSurfaceRefreshToken == token, let task = uiSurfaceRefreshTask {
            return await task.value
        }
        cancelUiSurfaceRefresh()
        let scopeId = token.source.scopeId
        let task = Task<Result<UiSurfaceBundle, Error>, Never> { [client] in
            do {
                return .success(try await client.fetchUiSurfaceBundle(scopeId: scopeId))
            } catch {
                return .failure(error)
            }
        }
        uiSurfaceRefreshToken = token
        uiSurfaceRefreshTask = task
        let result = await task.value
        if uiSurfaceRefreshToken == token {
            uiSurfaceRefreshToken = nil
            uiSurfaceRefreshTask = nil
        }
        return result
    }

    private func cancelUiSurfaceRefresh() {
        uiSurfaceRefreshTask?.cancel()
        uiSurfaceRefreshTask = nil
        uiSurfaceRefreshToken = nil
        isLoadingUiSurfaces = false
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

    func endSession(_ id: String) async {
        guard let token = synchronizeRequestSource() else { return }
        try? await client.deleteSession(id: id, scopeId: activeScopeId)
        guard isCurrent(token) else { return }
        _ = await fetchAll()
    }

    /// Reseed `activeScopeId` from the latest registry projection.
    /// Reused by the polling loop and by tests that drive the registry
    /// directly. Mirrors the web `ScopeProvider` behavior — preserves
    /// an existing valid selection, falls back to `defaultScopeId`
    /// when the prior selection is no longer in the registry.
    func reconcileActiveScopeId(with projection: ScopeRegistryProjection) {
        let knownIds = Set(projection.scopes.map { $0.scopeId })
        if let current = activeScopeId, knownIds.contains(current) { return }
        activeScopeId = projection.defaultScopeId
    }

    public func promptForScopeDirectory() async {
        if let url = await platform.pickScopeDirectory() {
            scopeRoot = url
            startPolling()
        }
    }
}
