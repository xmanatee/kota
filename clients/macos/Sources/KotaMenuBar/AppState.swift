import Foundation
import SwiftUI

private let pollInterval: TimeInterval = 5

@MainActor
final class AppState: ObservableObject {
    @Published var health: DaemonHealth = .unknown
    @Published var activeRuns: [ActiveRun] = []
    @Published var pendingApprovals: [ApprovalRequest] = []
    @Published var taskQueue: TaskQueueResponse?
    @Published var activeSessions: [SessionSummary] = []
    @Published var recentRuns: [RunSummary] = []
    @Published var projectDir: URL? {
        didSet {
            if let dir = projectDir {
                UserDefaults.standard.set(dir.path, forKey: "projectDirectory")
            }
        }
    }

    let client = DaemonClient()
    private var pollTask: Task<Void, Never>?

    init() {
        if let stored = UserDefaults.standard.string(forKey: "projectDirectory") {
            projectDir = URL(fileURLWithPath: stored)
        }
        startPolling()
    }

    var webUIURL: URL {
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

    func refresh() async {
        guard let dir = projectDir else {
            health = .offline
            return
        }

        let connected = client.refreshConnection(projectDir: dir)
        guard connected else {
            health = .offline
            activeRuns = []
            pendingApprovals = []
            taskQueue = nil
            activeSessions = []
            recentRuns = []
            return
        }

        async let statusResult: Result<DaemonStatusResponse, Error> = {
            do { return .success(try await client.fetchStatus()) }
            catch { return .failure(error) }
        }()
        async let approvalsResult: Result<ApprovalsResponse, Error> = {
            do { return .success(try await client.fetchApprovals()) }
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

        let (sr, ar, tr, sesr, rrr) = await (statusResult, approvalsResult, tasksResult, sessionsResult, recentRunsResult)

        switch sr {
        case .success(let status):
            let runs = status.workflow?.activeRuns ?? []
            activeRuns = runs
            health = runs.isEmpty ? .idle : .running(runs.count)
        case .failure(let error):
            health = .error(error.localizedDescription)
            activeRuns = []
        }

        switch ar {
        case .success(let resp):
            pendingApprovals = resp.approvals.filter { $0.status == "pending" }
        case .failure:
            pendingApprovals = []
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
    }

    func approve(id: String) async {
        try? await client.approve(id: id)
        await refresh()
    }

    func reject(id: String) async {
        try? await client.reject(id: id)
        await refresh()
    }

    func triggerWorkflow(name: String) async throws {
        _ = try await client.triggerWorkflow(name: name)
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
