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

private struct DaemonRequestToken: Equatable {
    let generation: Int
    let source: DaemonRequestSource
}

// MARK: - AppState

@MainActor
public final class AppState: ObservableObject {
    @Published var health: DaemonHealth = .unknown
    @Published var identity: ClientIdentity?

    // Canonical daemon-owned operator UI rendered by both Apple shells.
    @Published private(set) var uiSurfaces = ResourceStateOwner<UiSurfaceBundle>()
    @Published private(set) var slashCommands = ResourceStateOwner<[SlashCommand]>()
    @Published var uiSurfaceEventsConnected = false
    @Published var liveUiLogEntries: [String: [UiLogEntry]] = [:]

    /// Active scope for shared UI and session requests. Identity refreshes
    /// seed it from the registry default when the current selection is absent.
    @Published public private(set) var activeScopeId: String?

    /// Operator-facing classification of the current connection.
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

    var connectionMode: DaemonConnectionMode {
        remoteURL.isEmpty ? .local : .remote
    }

    public let client: DaemonClient
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
    private var slashCommandRefreshTask: Task<Result<SlashCommandsResponse, Error>, Never>?
    private var slashCommandRefreshID: UUID?
    private var started = false
    private var lastIdentityProbe: DaemonIdentityProbe?

    public init(
        client: DaemonClient? = nil,
        platform: PlatformAffordances = InertPlatformAffordances()
    ) {
        self.client = client ?? DaemonClient()
        self.platform = platform
        if let stored = UserDefaults.standard.string(forKey: "scopeDirectory") {
            scopeRoot = URL(fileURLWithPath: stored)
        }
        remoteURL = UserDefaults.standard.string(forKey: "remoteDaemonURL") ?? ""
    }

    public func start() {
        started = true
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
        start()
    }

    func clearRemoteConfig() {
        resetOfflineDaemonState()
        remoteURL = ""
        keychainDelete()
        start()
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
            let uiFailure = ResourceFailure.failed(ResourceIssue(
                title: "Shared UI unavailable",
                detail: "Invalid remote URL"
            ))
            let commandFailure = ResourceFailure.failed(ResourceIssue(
                title: "Commands unavailable",
                detail: "Invalid remote URL"
            ))
            resetOfflineDaemonState(
                uiFailure: uiFailure,
                commandFailure: commandFailure
            )
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
            resetOfflineDaemonState(issue: ResourceIssue(
                title: "Daemon offline",
                detail: diagnostic.detail
            ))
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
            resetOfflineDaemonState(issue: ResourceIssue(
                title: "Daemon offline",
                detail: diagnostic.detail
            ))
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
            resetOfflineDaemonState(issue: ResourceIssue(
                title: "Daemon offline",
                detail: diagnostic.detail
            ))
            return
        }

        guard await fetchAll() else { return }
        diagnostic = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
            controlFileState: controlFileState,
            identityProbe: lastIdentityProbe
        )
    }

    private func resetOfflineDaemonState(
        issue: ResourceIssue? = nil,
        uiFailure: ResourceFailure? = nil,
        commandFailure: ResourceFailure? = nil
    ) {
        client.clearConnection()
        invalidateRequestSource()
        identity = nil
        uiSurfaces.reset()
        slashCommands.reset()
        if let uiFailure {
            uiSurfaces.reject(uiFailure)
        } else if let issue {
            uiSurfaces.reject(.offline(issue))
        }
        if let commandFailure {
            slashCommands.reject(commandFailure)
        } else if let issue {
            slashCommands.reject(.offline(issue))
        }
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
        uiSurfaces.reset()
        slashCommands.reset()
        liveUiLogEntries = [:]
        stopUiSurfaceEventStream()
        Task { await refresh() }
    }

    private func fetchAll() async -> Bool {
        // Resolve identity before the scoped surface request.
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
        let surfacesResult = await requestUiSurfaceBundle(scopedToken)
        guard isCurrent(scopedToken) else { return false }
        switch surfacesResult {
        case .success(let bundle):
            applyUiSurfaceBundle(bundle, token: scopedToken)
            health = .connected
        case .failure(let error):
            let failure = resourceFailure(for: error)
            uiSurfaces.reject(failure)
            if case .offline(let issue) = failure {
                slashCommands.reject(.offline(issue))
            }
            stopUiSurfaceEventStream()
            health = .error(DaemonErrorPresenter.message(for: error))
        }
        await refreshSlashCommands(token: scopedToken)
        return true
    }

    // MARK: - Shared UI surface runtime

    func refreshUiSurfaceBundle() async {
        guard let token = synchronizeRequestSource() else {
            await refresh()
            return
        }
        await refreshUiSurfaceBundle(token: token)
    }

    func refreshSlashCommands() async {
        guard let token = synchronizeRequestSource() else {
            await refresh()
            return
        }
        await refreshSlashCommands(token: token)
    }

    private func refreshSlashCommands(token: DaemonRequestToken) async {
        guard isCurrent(token) else { return }
        cancelSlashCommandRefresh()
        slashCommands.beginLoading()
        let requestID = UUID()
        let task = Task<Result<SlashCommandsResponse, Error>, Never> { [client] in
            do {
                return .success(try await client.fetchSlashCommands())
            } catch {
                return .failure(error)
            }
        }
        slashCommandRefreshID = requestID
        slashCommandRefreshTask = task
        let result = await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        guard slashCommandRefreshID == requestID, isCurrent(token) else { return }
        slashCommandRefreshID = nil
        slashCommandRefreshTask = nil
        guard !Task.isCancelled else {
            slashCommands.cancelLoading()
            return
        }
        switch result {
        case .success(let response):
            slashCommands.resolve(response.commands, isEmpty: \.isEmpty)
        case .failure(let error) where isRequestCancellation(error):
            slashCommands.cancelLoading()
        case .failure(let error):
            slashCommands.reject(resourceFailure(for: error, title: "Commands unavailable"))
        }
    }

    private func refreshUiSurfaceBundle(token: DaemonRequestToken) async {
        guard isCurrent(token) else { return }
        switch await requestUiSurfaceBundle(token) {
        case .success(let bundle) where isCurrent(token):
            applyUiSurfaceBundle(bundle, token: token)
        case .failure(let error) where isCurrent(token):
            uiSurfaces.reject(resourceFailure(for: error))
        case .success, .failure:
            break
        }
    }

    func executeUiAction(
        _ action: UiAction,
        parameters: [String: UiJsonValue]? = nil,
        confirmed: Bool = false
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
            result = try await client.executeUiAction(
                action,
                parameters: parameters,
                confirmed: confirmed
            )
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
        uiSurfaces.resolve(bundle) { $0.surfaces.isEmpty }
        reconcileUiSurfaceEventStream(bundle: bundle, token: token)
    }

    private func reconcileUiSurfaceEventStream(bundle: UiSurfaceBundle, token: DaemonRequestToken) {
        guard started, isCurrent(token) else { return }
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
        guard let bundle = uiSurfaces.value else { return }
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
                ((liveUiLogEntries[streamId] ?? []) + [entry]).suffix(100)
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
            cancelSlashCommandRefresh()
            uiSurfaces.reset()
            slashCommands.reset()
            liveUiLogEntries = [:]
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
        cancelSlashCommandRefresh()
        stopUiSurfaceEventStream()
    }

    private func requestUiSurfaceBundle(
        _ token: DaemonRequestToken
    ) async -> Result<UiSurfaceBundle, Error> {
        guard isCurrent(token) else {
            return .failure(CancellationError())
        }
        uiSurfaces.beginLoading()
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
    }

    private func cancelSlashCommandRefresh() {
        slashCommandRefreshTask?.cancel()
        slashCommandRefreshTask = nil
        slashCommandRefreshID = nil
    }

    private func isRequestCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    private func resourceFailure(
        for error: Error,
        title: String = "Shared UI unavailable"
    ) -> ResourceFailure {
        let detail = DaemonErrorPresenter.message(for: error)
        if isDaemonTransportLoss(error) {
            return .offline(ResourceIssue(title: "Daemon offline", detail: detail))
        }
        guard let daemonError = error as? DaemonClientError else {
            return .failed(ResourceIssue(title: title, detail: detail))
        }
        switch daemonError {
        case .notConnected:
            return .offline(ResourceIssue(title: "Daemon offline", detail: detail))
        case .httpError(let status, _) where status == 503:
            return .unavailable(ResourceIssue(title: title, detail: detail))
        case .httpError, .decodingError:
            return .failed(ResourceIssue(title: title, detail: detail))
        }
    }

    private func isDaemonTransportLoss(_ error: Error) -> Bool {
        guard let code = (error as? URLError)?.code else { return false }
        switch code {
        case .timedOut,
             .cannotFindHost,
             .cannotConnectToHost,
             .networkConnectionLost,
             .dnsLookupFailed,
             .notConnectedToInternet,
             .internationalRoamingOff,
             .callIsActive,
             .dataNotAllowed,
             .backgroundSessionWasDisconnected:
            return true
        default:
            return false
        }
    }

    func endSession(_ id: String) async {
        guard let token = synchronizeRequestSource() else { return }
        try? await client.deleteSession(id: id, scopeId: activeScopeId)
        guard isCurrent(token) else { return }
        await refreshUiSurfaceBundle(token: token)
    }

    /// Reseed `activeScopeId` from the latest registry projection.
    /// Reused by the polling loop and by tests that drive the registry
    /// directly. Mirrors the web `ScopeProvider` behavior — preserves
    /// an existing valid selection, falls back to `defaultScopeId`
    /// when the prior selection is no longer in the registry.
    func reconcileActiveScopeId(with projection: ScopeRegistryProjection) {
        let knownIds = Set(projection.scopes.map { $0.scopeId })
        if let current = activeScopeId, knownIds.contains(current) { return }
        guard activeScopeId != projection.defaultScopeId else { return }
        activeScopeId = projection.defaultScopeId
        uiSurfaces.reset()
        slashCommands.reset()
        liveUiLogEntries = [:]
        stopUiSurfaceEventStream()
    }

    public func promptForScopeDirectory() async {
        if let url = await platform.pickScopeDirectory() {
            scopeRoot = url
            start()
        }
    }
}
