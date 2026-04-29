import Foundation

/// Result of the most recent attempt to read `.kota/daemon-control.json`
/// from the operator-selected project directory. Modeled as a typed
/// discriminated state so the diagnostic derivation does not have to
/// re-parse the file or guess from a `nil` connection.
///
/// The control-file token is intentionally never carried in this enum —
/// callers that need the token use `DaemonClient.refreshConnection`
/// instead. Diagnostics must remain safe to render and log.
enum DaemonControlFileState: Equatable {
    /// `.kota/daemon-control.json` does not exist at the selected project.
    case missing
    /// File exists, parses, and the daemon process is alive.
    case fresh(port: Int, pid: Int)
    /// File exists and parses, but the recorded pid is not alive — a
    /// previous daemon left this file behind without cleaning up.
    case stale(port: Int, pid: Int)
    /// File exists but cannot be parsed as the documented control shape.
    case unreadable
}

/// Result of asking the daemon for its `/identity`. Modeled as a typed
/// discriminated state so the diagnostic can distinguish "daemon
/// rejected our token" from "daemon never responded".
enum DaemonIdentityProbe: Equatable {
    case ok(ClientIdentity)
    /// HTTP 401 or 403 — the token in the control file did not satisfy
    /// the daemon. Distinct from a connection failure.
    case tokenRejected(status: Int)
    /// Any other transport or HTTP failure (timeout, refused, 5xx, etc.).
    case unreachable
}

/// Typed, operator-facing summary of which daemon a thin client is
/// talking to and why a given connection attempt is in the state it is.
/// The purpose is to replace the historical "Daemon offline" string —
/// which collapsed missing control file, stale control file, wrong
/// project, token rejected, and remote-mode failures into one line —
/// with a discriminated state the UI can render unambiguously.
///
/// Every arm carries the inputs the operator needs to diagnose the
/// mismatch (selected project path, daemon base URL when known, daemon
/// project path when the daemon answered `/identity`), and never the
/// bearer token. The enum is pure data so it can be derived in a unit
/// test without spinning up `URLSession` or instantiating `AppState`.
enum DaemonConnectionDiagnostic: Equatable {
    /// No project directory has been chosen and no remote URL is set.
    /// The operator must pick a project before the menu bar can show
    /// any daemon identity at all.
    case noProject

    /// A project directory is selected but `.kota/daemon-control.json`
    /// is missing. Either the daemon was never started for this project
    /// or this is the wrong project for the running daemon.
    case noControlFile(projectDir: String)

    /// The control file is present but cannot be parsed in the documented
    /// shape (legacy / partial write / wrong file). This is rare but
    /// distinct from `noControlFile` so the operator does not get a
    /// generic "missing" message when the file actually exists.
    case unreadableControlFile(projectDir: String)

    /// The control file is present and parses, but the recorded pid is
    /// not alive. The operator should run `kota doctor --fix` (or restart
    /// the daemon) — keeping the stale lock around will keep masking the
    /// daemon's real state.
    case staleControlFile(projectDir: String, pid: Int, baseURL: String)

    /// The control file is fresh and the pid is alive, but the daemon
    /// never responded to `/identity`. Carries the base URL so the
    /// operator can confirm "yes, that is the URL I expect" without
    /// inspecting the control file by hand.
    case unreachable(projectDir: String, baseURL: String, pid: Int)

    /// The daemon responded with HTTP 401 or 403. The token in the
    /// control file is no longer valid — most often a stale file
    /// pointing at a daemon process that was restarted under a different
    /// token. Does not reveal the token in the message.
    case tokenRejected(projectDir: String, baseURL: String, status: Int)

    /// The daemon responded with `/identity`, but its `projectDir` does
    /// not match the operator-selected `projectDir`. This is the exact
    /// state the 2026-04-28 incident ended in — the operator selected
    /// project /b but the running daemon was for project /a, so the menu
    /// bar showed "Daemon offline" even though KOTA was alive elsewhere.
    /// Carries enough information for the operator to switch projects
    /// or restart the daemon under the right root.
    case wrongProject(
        selectedDir: String,
        daemonProjectName: String,
        daemonProjectDir: String,
        baseURL: String
    )

    /// Connected to the daemon and `/identity.projectDir` matches the
    /// selected project. The operator can trust the rest of the menu
    /// bar's view of this daemon.
    case connected(identity: ClientIdentity, baseURL: String)

    /// Operator configured a remote URL and the daemon answered the
    /// identity probe. The base URL is known (the operator entered it),
    /// so we render that even if the identity payload could not be
    /// decoded.
    case remoteConnected(identity: ClientIdentity, baseURL: String)

    /// Operator configured a remote URL but the daemon did not respond
    /// to `/identity`. Reason captures whether the failure was a token
    /// rejection or a transport problem so the operator can fix the
    /// right thing.
    case remoteUnreachable(baseURL: String, reason: RemoteFailureReason)

    /// The remote URL the operator entered does not parse as a URL at
    /// all. Distinct from `remoteUnreachable` because the operator must
    /// fix the configuration, not the daemon.
    case remoteInvalidURL(input: String)

    enum RemoteFailureReason: Equatable {
        case tokenRejected(status: Int)
        case unreachable
    }

    /// Single short line for the menu-bar status header. Never includes
    /// the bearer token; tokens are deliberately not threaded into this
    /// type at all.
    var headline: String {
        switch self {
        case .noProject:
            return "No project selected"
        case .noControlFile(let projectDir):
            return "No daemon for \(displayName(projectDir))"
        case .unreadableControlFile(let projectDir):
            return "Unreadable daemon-control.json (\(displayName(projectDir)))"
        case .staleControlFile(let projectDir, let pid, _):
            return "Stale daemon for \(displayName(projectDir)) (pid \(pid) gone)"
        case .unreachable(let projectDir, _, _):
            return "Daemon not responding (\(displayName(projectDir)))"
        case .tokenRejected(let projectDir, _, let status):
            return "Daemon rejected token (HTTP \(status), \(displayName(projectDir)))"
        case .wrongProject(_, let daemonProjectName, _, _):
            return "Wrong project — daemon is on \(daemonProjectName)"
        case .connected(let identity, _):
            return identity.projectName
        case .remoteConnected(let identity, _):
            return "Remote: \(identity.projectName)"
        case .remoteUnreachable(_, let reason):
            switch reason {
            case .tokenRejected(let status):
                return "Remote daemon rejected token (HTTP \(status))"
            case .unreachable:
                return "Remote daemon not responding"
            }
        case .remoteInvalidURL:
            return "Remote URL is invalid"
        }
    }

    /// Long-form line shown beneath the headline. Includes the daemon
    /// base URL when known, the selected project path, and (for the
    /// wrong-project case) both project paths so the operator can see the
    /// mismatch directly.
    var detail: String {
        switch self {
        case .noProject:
            return "Pick a project directory to discover the daemon."
        case .noControlFile(let projectDir):
            return "\(projectDir)/.kota/daemon-control.json is missing."
        case .unreadableControlFile(let projectDir):
            return "\(projectDir)/.kota/daemon-control.json could not be parsed."
        case .staleControlFile(let projectDir, _, let baseURL):
            return "\(projectDir) → \(baseURL). Run `kota doctor --fix` to clear the lock."
        case .unreachable(let projectDir, let baseURL, let pid):
            return "\(projectDir) → \(baseURL) (pid \(pid)). The daemon process is alive but did not answer."
        case .tokenRejected(let projectDir, let baseURL, _):
            return "\(projectDir) → \(baseURL). The control-file token did not satisfy the daemon."
        case .wrongProject(let selectedDir, _, let daemonProjectDir, let baseURL):
            return "Selected: \(selectedDir)\nDaemon: \(daemonProjectDir) → \(baseURL)"
        case .connected(let identity, let baseURL):
            return "\(identity.projectDir) → \(baseURL)"
        case .remoteConnected(let identity, let baseURL):
            return "\(identity.projectDir) → \(baseURL)"
        case .remoteUnreachable(let baseURL, _):
            return baseURL
        case .remoteInvalidURL(let input):
            return input.isEmpty ? "Remote URL is empty." : "Could not parse \"\(input)\" as a URL."
        }
    }

    /// True when the diagnostic represents a healthy connection where
    /// the rest of the menu bar can trust the daemon's payloads.
    var isConnected: Bool {
        switch self {
        case .connected, .remoteConnected:
            return true
        default:
            return false
        }
    }

    /// Display style used by the SwiftUI header so operators can tell
    /// "everything is fine" from "something needs attention" at a glance,
    /// without color overloading the existing health icon.
    var severity: Severity {
        switch self {
        case .connected, .remoteConnected:
            return .ok
        case .noProject, .noControlFile:
            return .info
        case .staleControlFile, .unreadableControlFile, .wrongProject,
             .tokenRejected, .remoteInvalidURL:
            return .warn
        case .unreachable, .remoteUnreachable:
            return .error
        }
    }

    enum Severity {
        case ok
        case info
        case warn
        case error
    }

    private func displayName(_ projectDir: String) -> String {
        let url = URL(fileURLWithPath: projectDir)
        let name = url.lastPathComponent
        return name.isEmpty ? projectDir : name
    }
}

/// True when a process with the given pid is alive (or the caller lacks
/// permission to signal it, which also implies the process exists).
/// Mirrors `src/core/util/process-alive.ts` so the macOS thin client
/// classifies a stale daemon-control file the same way as `kota doctor`.
func isProcessAlive(pid: Int) -> Bool {
    // Sending signal 0 only checks for existence + signaling permission.
    let result = kill(pid_t(pid), 0)
    if result == 0 { return true }
    return errno == EPERM
}

/// Reads `.kota/daemon-control.json` from the given project directory and
/// classifies the result. Pure with respect to its inputs except for the
/// pid-liveness check, which is injected so unit tests can simulate a
/// stale lock without depending on a real OS process.
func classifyDaemonControlFile(
    projectDir: URL,
    fileManager: FileManager = .default,
    decoder: JSONDecoder = JSONDecoder(),
    processIsAlive: (Int) -> Bool = isProcessAlive
) -> DaemonControlFileState {
    let controlPath = projectDir
        .appendingPathComponent(".kota")
        .appendingPathComponent("daemon-control.json")
    guard fileManager.fileExists(atPath: controlPath.path) else {
        return .missing
    }
    guard let data = try? Data(contentsOf: controlPath) else {
        return .unreadable
    }
    guard let control = try? decoder.decode(DaemonControlFile.self, from: data) else {
        return .unreadable
    }
    if processIsAlive(control.pid) {
        return .fresh(port: control.port, pid: control.pid)
    }
    return .stale(port: control.port, pid: control.pid)
}

/// Pure derivation of the operator-facing diagnostic from inputs the
/// `AppState` already has. Splitting this out keeps the thin client's
/// connection-identity rules unit-testable without instantiating
/// `AppState` (whose `init` reaches into `UNUserNotificationCenter`).
///
/// `selectedProjectDir` is the operator's chosen project (UserDefaults
/// `projectDirectory`). `controlFileState` is the result of
/// `classifyDaemonControlFile`. `identityProbe` is what
/// `DaemonClient.fetchIdentity` returned (or nil when no probe was
/// attempted because we never had a connection in the first place).
func deriveLocalDaemonDiagnostic(
    selectedProjectDir: URL?,
    controlFileState: DaemonControlFileState,
    identityProbe: DaemonIdentityProbe?
) -> DaemonConnectionDiagnostic {
    guard let projectDir = selectedProjectDir else {
        return .noProject
    }
    let projectPath = projectDir.path
    switch controlFileState {
    case .missing:
        return .noControlFile(projectDir: projectPath)
    case .unreadable:
        return .unreadableControlFile(projectDir: projectPath)
    case .stale(let port, let pid):
        return .staleControlFile(
            projectDir: projectPath,
            pid: pid,
            baseURL: "http://127.0.0.1:\(port)"
        )
    case .fresh(let port, let pid):
        let baseURL = "http://127.0.0.1:\(port)"
        switch identityProbe {
        case .none, .some(.unreachable):
            return .unreachable(projectDir: projectPath, baseURL: baseURL, pid: pid)
        case .some(.tokenRejected(let status)):
            return .tokenRejected(projectDir: projectPath, baseURL: baseURL, status: status)
        case .some(.ok(let identity)):
            if identity.projectDir == projectPath {
                return .connected(identity: identity, baseURL: baseURL)
            }
            return .wrongProject(
                selectedDir: projectPath,
                daemonProjectName: identity.projectName,
                daemonProjectDir: identity.projectDir,
                baseURL: baseURL
            )
        }
    }
}

/// Pure derivation for the remote-URL connection mode. Mirrors the local
/// version: the operator-entered URL plus the latest identity probe map
/// directly into one of the remote-mode arms.
func deriveRemoteDaemonDiagnostic(
    remoteURL: String,
    identityProbe: DaemonIdentityProbe?
) -> DaemonConnectionDiagnostic {
    guard let parsed = URL(string: remoteURL), parsed.scheme != nil, parsed.host != nil else {
        return .remoteInvalidURL(input: remoteURL)
    }
    let baseURL = parsed.absoluteString
    switch identityProbe {
    case .none, .some(.unreachable):
        return .remoteUnreachable(baseURL: baseURL, reason: .unreachable)
    case .some(.tokenRejected(let status)):
        return .remoteUnreachable(baseURL: baseURL, reason: .tokenRejected(status: status))
    case .some(.ok(let identity)):
        return .remoteConnected(identity: identity, baseURL: baseURL)
    }
}

/// Maps a `DaemonClientError` raised by `fetchIdentity` into the
/// classified probe outcome. 401/403 always become `tokenRejected`; every
/// other error (including `notConnected`, decoding drift, and 5xx) is
/// treated as transport failure.
func classifyIdentityFailure(_ error: Error) -> DaemonIdentityProbe {
    if let daemonError = error as? DaemonClientError {
        switch daemonError {
        case .httpError(let status, _) where status == 401 || status == 403:
            return .tokenRejected(status: status)
        default:
            return .unreachable
        }
    }
    return .unreachable
}
