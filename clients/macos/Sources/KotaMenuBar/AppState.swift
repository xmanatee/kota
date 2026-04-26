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

enum DaemonConnectionMode {
    case local
    case remote
}

// MARK: - AppState

@MainActor
final class AppState: ObservableObject {
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

    let client = DaemonClient()
    private var pollTask: Task<Void, Never>?

    private var knownFailedRunIDs: Set<String> = []
    private var knownApprovalIDs: Set<String> = []
    private var knownOwnerQuestionIDs: Set<String> = []
    private var notificationStateInitialized = false

    init() {
        if let stored = UserDefaults.standard.string(forKey: "projectDirectory") {
            projectDir = URL(fileURLWithPath: stored)
        }
        remoteURL = UserDefaults.standard.string(forKey: "remoteDaemonURL") ?? ""
        NotificationManager.shared.requestAuthorization()
        startPolling()
    }

    var webUIURL: URL {
        if !remoteURL.isEmpty, let base = URL(string: remoteURL) {
            // Best-effort: point web UI at the same host/port
            return base
        }
        let port = UserDefaults.standard.integer(forKey: "webUIPort")
        return URL(string: "http://localhost:\(port > 0 ? port : 3000)")!
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
        guard let url = URL(string: remoteURL) else {
            health = .error("Invalid remote URL")
            return
        }
        let token = keychainRead() ?? ""
        client.setRemoteConnection(url: url, token: token)
        await fetchAll()
    }

    private func refreshLocal() async {
        guard let dir = projectDir else {
            health = .offline
            clearOnDemandForOffline()
            return
        }

        let connected = client.refreshConnection(projectDir: dir)
        guard connected else {
            health = .offline
            activeRuns = []
            pendingApprovals = []
            pendingOwnerQuestions = []
            taskQueue = nil
            activeSessions = []
            recentRuns = []
            clearOnDemandForOffline()
            return
        }

        await fetchAll()
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
            digestError = error.localizedDescription
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
            attentionError = error.localizedDescription
        }
        isLoadingAttention = false
    }

    private func fetchAll() async {
        async let statusResult: Result<DaemonStatusResponse, Error> = {
            do { return .success(try await client.fetchStatus()) }
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
            do { return .success(try await client.fetchSessions()) }
            catch { return .failure(error) }
        }()
        async let recentRunsResult: Result<RunHistoryResponse, Error> = {
            do { return .success(try await client.fetchRecentRuns()) }
            catch { return .failure(error) }
        }()

        let (sr, ar, oqr, tr, sesr, rrr) = await (statusResult, approvalsResult, ownerQuestionsResult, tasksResult, sessionsResult, recentRunsResult)

        switch sr {
        case .success(let status):
            let runs = status.workflow?.activeRuns ?? []
            activeRuns = runs
            health = runs.isEmpty ? .idle : .running(runs.count)
        case .failure(let error):
            health = .error(error.localizedDescription)
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

    private func checkForNotifications() {
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
                    NotificationManager.shared.notify(
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
                    NotificationManager.shared.notify(
                        title: "Approval needed",
                        body: body,
                        identifier: "approval-\(id)"
                    )
                }
            }
            for id in currentOwnerQuestionIDs.subtracting(knownOwnerQuestionIDs) {
                if let question = pendingOwnerQuestions.first(where: { $0.id == id }) {
                    NotificationManager.shared.notify(
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

    func triggerWorkflow(name: String) async throws {
        _ = try await client.triggerWorkflow(name: name)
        await refresh()
    }

    func createSession(autonomyMode: AutonomyMode? = nil) async -> String? {
        return try? await client.createSession(autonomyMode: autonomyMode)
    }

    func endSession(_ id: String) async {
        try? await client.deleteSession(id: id)
        await refresh()
    }

    func setSessionAutonomyMode(id: String, mode: AutonomyMode) async {
        _ = try? await client.setSessionAutonomyMode(id: id, mode: mode)
        await refresh()
    }

    func openDashboard() {
        NSWorkspace.shared.open(webUIURL)
    }

    func promptForProjectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select your KOTA project directory (the folder containing .kota/)"
        panel.prompt = "Select"
        if panel.runModal() == .OK, let url = panel.url {
            projectDir = url
            startPolling()
        }
    }
}
