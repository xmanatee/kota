import XCTest
@testable import KotaMenuBar

/// Coverage for the typed `DaemonConnectionDiagnostic` derivation. The
/// macOS menu bar headline previously collapsed every connection failure
/// into "Daemon offline", which masked the real reason the operator could
/// not reach the daemon (no control file, stale lock, token rejected,
/// wrong project, transport failure). These tests pin the operator-
/// facing classification of each branch the task contract enumerates,
/// without spinning up an HTTP server or instantiating `AppState`.
///
/// `AppState` is intentionally not constructed here for the same reason
/// `AnswerViewTests` documents: its `init` reaches into
/// `UNUserNotificationCenter.current()`, which crashes outside a `.app`
/// bundle. The diagnostic derivation is pure, so we exercise it directly.
final class DaemonConnectionDiagnosticTests: XCTestCase {

    // MARK: - Local-mode classification

    func testNoProjectWhenSelectedDirIsNil() {
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: nil,
            controlFileState: .missing,
            identityProbe: nil
        )
        XCTAssertEqual(diag, .noProject)
        XCTAssertFalse(diag.isConnected)
        XCTAssertEqual(diag.severity, .info)
        XCTAssertEqual(diag.headline, "No project selected")
    }

    func testNoControlFileWhenProjectHasNoLock() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/other-project")
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: .missing,
            identityProbe: nil
        )
        XCTAssertEqual(diag, .noControlFile(projectDir: dir.path))
        XCTAssertFalse(diag.isConnected)
        XCTAssertEqual(diag.headline, "No daemon for other-project")
        XCTAssertTrue(diag.detail.contains("daemon-control.json is missing"))
    }

    func testUnreadableControlFile() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: .unreadable,
            identityProbe: nil
        )
        XCTAssertEqual(diag, .unreadableControlFile(projectDir: dir.path))
        XCTAssertEqual(diag.severity, .warn)
    }

    func testStaleControlFileFlagsPidGone() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: .stale(port: 8765, pid: 99999),
            identityProbe: nil
        )
        XCTAssertEqual(
            diag,
            .staleControlFile(projectDir: dir.path, pid: 99999, baseURL: "http://127.0.0.1:8765")
        )
        XCTAssertEqual(diag.severity, .warn)
        XCTAssertTrue(diag.headline.contains("Stale daemon"))
        XCTAssertTrue(diag.headline.contains("99999"))
        XCTAssertTrue(diag.detail.contains("kota doctor --fix"))
    }

    func testFreshControlFileButIdentityProbeNeverRanIsUnreachable() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: .fresh(port: 8765, pid: 12345),
            identityProbe: nil
        )
        XCTAssertEqual(
            diag,
            .unreachable(projectDir: dir.path, baseURL: "http://127.0.0.1:8765", pid: 12345)
        )
        XCTAssertEqual(diag.severity, .error)
        XCTAssertTrue(diag.detail.contains("pid 12345"))
    }

    func testFreshControlFileWithUnreachableProbe() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: .fresh(port: 8765, pid: 12345),
            identityProbe: .unreachable
        )
        if case .unreachable = diag {
            // expected
        } else {
            XCTFail("expected .unreachable, got \(diag)")
        }
    }

    func testFreshControlFileWithTokenRejection() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: .fresh(port: 8765, pid: 1),
            identityProbe: .tokenRejected(status: 401)
        )
        XCTAssertEqual(
            diag,
            .tokenRejected(projectDir: dir.path, baseURL: "http://127.0.0.1:8765", status: 401)
        )
        XCTAssertEqual(diag.severity, .warn)
        XCTAssertTrue(diag.headline.contains("HTTP 401"))
    }

    func testWrongProjectMismatchAfterIdentityProbe() {
        let selected = URL(fileURLWithPath: "/Users/op/Desktop/other-app")
        let identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/Users/op/Desktop/mono/apps/kota",
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .unavailable(reason: "module_disabled", message: nil)
        )
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: selected,
            controlFileState: .fresh(port: 8765, pid: 4242),
            identityProbe: .ok(identity)
        )
        XCTAssertEqual(
            diag,
            .wrongProject(
                selectedDir: selected.path,
                daemonProjectName: "kota",
                daemonProjectDir: identity.projectDir,
                baseURL: "http://127.0.0.1:8765"
            )
        )
        XCTAssertEqual(diag.severity, .warn)
        XCTAssertEqual(diag.headline, "Wrong project — daemon is on kota")
        XCTAssertTrue(diag.detail.contains(selected.path))
        XCTAssertTrue(diag.detail.contains(identity.projectDir))
    }

    func testConnectedWhenIdentityMatchesSelectedProjectDir() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/mono/apps/kota")
        let identity = ClientIdentity(
            projectName: "kota",
            projectDir: dir.path,
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        let diag = deriveLocalDaemonDiagnostic(
            selectedProjectDir: dir,
            controlFileState: .fresh(port: 8765, pid: 4242),
            identityProbe: .ok(identity)
        )
        XCTAssertEqual(diag, .connected(identity: identity, baseURL: "http://127.0.0.1:8765"))
        XCTAssertTrue(diag.isConnected)
        XCTAssertEqual(diag.severity, .ok)
        XCTAssertEqual(diag.headline, "kota")
        XCTAssertTrue(diag.detail.contains("http://127.0.0.1:8765"))
    }

    // MARK: - Remote-mode classification

    func testRemoteInvalidURL() {
        let diag = deriveRemoteDaemonDiagnostic(remoteURL: "not a url", identityProbe: nil)
        XCTAssertEqual(diag, .remoteInvalidURL(input: "not a url"))
        XCTAssertEqual(diag.severity, .warn)
    }

    func testRemoteEmptyStringClassifiesAsInvalid() {
        let diag = deriveRemoteDaemonDiagnostic(remoteURL: "", identityProbe: nil)
        XCTAssertEqual(diag, .remoteInvalidURL(input: ""))
    }

    func testRemoteUnreachableWithoutProbe() {
        let diag = deriveRemoteDaemonDiagnostic(
            remoteURL: "https://kota.example.com",
            identityProbe: nil
        )
        XCTAssertEqual(
            diag,
            .remoteUnreachable(baseURL: "https://kota.example.com", reason: .unreachable)
        )
        XCTAssertEqual(diag.severity, .error)
    }

    func testRemoteUnreachableWithTokenRejection() {
        let diag = deriveRemoteDaemonDiagnostic(
            remoteURL: "https://kota.example.com",
            identityProbe: .tokenRejected(status: 403)
        )
        XCTAssertEqual(
            diag,
            .remoteUnreachable(baseURL: "https://kota.example.com", reason: .tokenRejected(status: 403))
        )
        XCTAssertEqual(diag.headline, "Remote daemon rejected token (HTTP 403)")
    }

    func testRemoteConnectedWithIdentity() {
        let identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/srv/kota",
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        let diag = deriveRemoteDaemonDiagnostic(
            remoteURL: "https://kota.example.com",
            identityProbe: .ok(identity)
        )
        XCTAssertEqual(
            diag,
            .remoteConnected(identity: identity, baseURL: "https://kota.example.com")
        )
        XCTAssertTrue(diag.isConnected)
        XCTAssertEqual(diag.headline, "Remote: kota")
    }

    // MARK: - Identity-probe classification

    func testClassifyIdentityFailureMaps401To403ToTokenRejected() {
        let err401: DaemonClientError = .httpError(status: 401, body: nil)
        let err403: DaemonClientError = .httpError(status: 403, body: nil)
        XCTAssertEqual(classifyIdentityFailure(err401), .tokenRejected(status: 401))
        XCTAssertEqual(classifyIdentityFailure(err403), .tokenRejected(status: 403))
    }

    func testClassifyIdentityFailureMapsOtherErrorsToUnreachable() {
        let err503: DaemonClientError = .httpError(status: 503, body: nil)
        let errDecoding: DaemonClientError = .decodingError(description: "drift")
        let errNotConnected: DaemonClientError = .notConnected
        XCTAssertEqual(classifyIdentityFailure(err503), .unreachable)
        XCTAssertEqual(classifyIdentityFailure(errDecoding), .unreachable)
        XCTAssertEqual(classifyIdentityFailure(errNotConnected), .unreachable)
        struct GenericError: LocalizedError {
            var errorDescription: String? { "boom" }
        }
        XCTAssertEqual(classifyIdentityFailure(GenericError()), .unreachable)
    }

    // MARK: - classifyDaemonControlFile (filesystem behavior)

    func testClassifyDaemonControlFileMissing() throws {
        let tmp = try makeTempProjectDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        XCTAssertEqual(classifyDaemonControlFile(projectDir: tmp), .missing)
    }

    func testClassifyDaemonControlFileFresh() throws {
        let tmp = try makeTempProjectDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        try writeControlFile(in: tmp, port: 8765, pid: 4242)
        let state = classifyDaemonControlFile(
            projectDir: tmp,
            processIsAlive: { $0 == 4242 }
        )
        XCTAssertEqual(state, .fresh(port: 8765, pid: 4242))
    }

    func testClassifyDaemonControlFileStale() throws {
        let tmp = try makeTempProjectDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        try writeControlFile(in: tmp, port: 8765, pid: 99999)
        let state = classifyDaemonControlFile(
            projectDir: tmp,
            processIsAlive: { _ in false }
        )
        XCTAssertEqual(state, .stale(port: 8765, pid: 99999))
    }

    func testClassifyDaemonControlFileUnreadableJSON() throws {
        let tmp = try makeTempProjectDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        let kotaDir = tmp.appendingPathComponent(".kota")
        try FileManager.default.createDirectory(at: kotaDir, withIntermediateDirectories: true)
        let path = kotaDir.appendingPathComponent("daemon-control.json")
        try "<not json>".data(using: .utf8)!.write(to: path)
        let state = classifyDaemonControlFile(projectDir: tmp)
        XCTAssertEqual(state, .unreadable)
    }

    // MARK: - Bearer token value never appears in any rendered string

    /// Pins the structural guarantee that `DaemonConnectionDiagnostic`
    /// does not carry the bearer token. The control file used in
    /// `testClassifyDaemonControlFileFresh` writes a synthetic token
    /// value; if any future arm started threading the token through, a
    /// pipeline test would render that value and fail this guard.
    func testBearerTokenValueIsNeverIncludedInDiagnosticRendering() throws {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let identity = ClientIdentity(
            projectName: "kota",
            projectDir: dir.path,
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        let cases: [DaemonConnectionDiagnostic] = [
            .noProject,
            .noControlFile(projectDir: dir.path),
            .unreadableControlFile(projectDir: dir.path),
            .staleControlFile(projectDir: dir.path, pid: 1, baseURL: "http://127.0.0.1:8765"),
            .unreachable(projectDir: dir.path, baseURL: "http://127.0.0.1:8765", pid: 1),
            .tokenRejected(projectDir: dir.path, baseURL: "http://127.0.0.1:8765", status: 401),
            .wrongProject(
                selectedDir: dir.path,
                daemonProjectName: "kota",
                daemonProjectDir: "/srv/kota",
                baseURL: "http://127.0.0.1:8765"
            ),
            .connected(identity: identity, baseURL: "http://127.0.0.1:8765"),
            .remoteConnected(identity: identity, baseURL: "https://kota.example.com"),
            .remoteUnreachable(baseURL: "https://kota.example.com", reason: .unreachable),
            .remoteInvalidURL(input: "not a url"),
        ]
        let bearerValue = "REDACTED-TEST-TOKEN"
        let bearerHeader = "Bearer REDACTED-TEST-TOKEN"
        for diag in cases {
            XCTAssertFalse(
                diag.headline.contains(bearerValue),
                "headline for \(diag) leaked the bearer value"
            )
            XCTAssertFalse(
                diag.detail.contains(bearerValue),
                "detail for \(diag) leaked the bearer value"
            )
            XCTAssertFalse(
                diag.headline.contains(bearerHeader),
                "headline for \(diag) leaked the bearer header"
            )
            XCTAssertFalse(
                diag.detail.contains(bearerHeader),
                "detail for \(diag) leaked the bearer header"
            )
        }
    }

    // MARK: - Rendered evidence snapshot

    /// Writes the canonical rendered headline + detail line for every
    /// diagnostic arm to the latest run directory under `.kota/runs/`
    /// (when present) so reviewers have a deterministic file showing
    /// exactly what the menu bar's `StatusHeaderView` renders for each
    /// scenario. Mirrors the pattern in
    /// `DaemonClientErrorTests.testWritesRenderedErrorStringsSnapshot`.
    /// Write-only side effect; no assertions depend on the file existing.
    func testWritesRenderedDiagnosticSnapshot() throws {
        let identity = ClientIdentity(
            projectName: "kota",
            projectDir: "/Users/op/Desktop/mono/apps/kota",
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        let cases: [(String, DaemonConnectionDiagnostic)] = [
            ("noProject", .noProject),
            ("noControlFile", .noControlFile(projectDir: "/Users/op/Desktop/other-app")),
            ("unreadableControlFile",
             .unreadableControlFile(projectDir: "/Users/op/Desktop/mono/apps/kota")),
            ("staleControlFile",
             .staleControlFile(
                projectDir: "/Users/op/Desktop/mono/apps/kota",
                pid: 99999,
                baseURL: "http://127.0.0.1:8765"
             )),
            ("unreachable",
             .unreachable(
                projectDir: "/Users/op/Desktop/mono/apps/kota",
                baseURL: "http://127.0.0.1:8765",
                pid: 12345
             )),
            ("tokenRejected",
             .tokenRejected(
                projectDir: "/Users/op/Desktop/mono/apps/kota",
                baseURL: "http://127.0.0.1:8765",
                status: 401
             )),
            ("wrongProject",
             .wrongProject(
                selectedDir: "/Users/op/Desktop/other-app",
                daemonProjectName: "kota",
                daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
                baseURL: "http://127.0.0.1:8765"
             )),
            ("connected", .connected(identity: identity, baseURL: "http://127.0.0.1:8765")),
            ("remoteConnected",
             .remoteConnected(identity: identity, baseURL: "https://kota.example.com")),
            ("remoteUnreachable",
             .remoteUnreachable(baseURL: "https://kota.example.com", reason: .unreachable)),
            ("remoteUnreachableTokenRejected",
             .remoteUnreachable(
                baseURL: "https://kota.example.com",
                reason: .tokenRejected(status: 403)
             )),
            ("remoteInvalidURL", .remoteInvalidURL(input: "not a url")),
        ]
        var lines: [String] = [
            "# Rendered macOS menu-bar diagnostic snapshot",
            "# Generated by DaemonConnectionDiagnosticTests.testWritesRenderedDiagnosticSnapshot",
            "# Each block shows the headline and detail line StatusHeaderView renders for that diagnostic.",
            "",
        ]
        for (name, diag) in cases {
            lines.append("[\(name)] severity=\(diag.severity) connected=\(diag.isConnected)")
            lines.append("  headline: \(diag.headline)")
            for detailLine in diag.detail.split(separator: "\n") {
                lines.append("  detail:   \(detailLine)")
            }
            lines.append("")
        }
        let snapshot = lines.joined(separator: "\n")

        guard let snapshotURL = Self.snapshotPath() else { return }
        try? FileManager.default.createDirectory(
            at: snapshotURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try snapshot.write(to: snapshotURL, atomically: true, encoding: .utf8)
    }

    private static func snapshotPath() -> URL? {
        let env = ProcessInfo.processInfo.environment
        if let runDir = env["KOTA_RUN_DIR"], !runDir.isEmpty {
            return URL(fileURLWithPath: runDir)
                .appendingPathComponent("rendered-diagnostic-states.txt")
        }
        let fm = FileManager.default
        var url = URL(fileURLWithPath: fm.currentDirectoryPath)
        for _ in 0..<6 {
            let candidate = url.appendingPathComponent(".kota/runs")
            if let entries = try? fm.contentsOfDirectory(
                at: candidate,
                includingPropertiesForKeys: [.contentModificationDateKey]
            ) {
                let latest = entries
                    .filter { $0.hasDirectoryPath }
                    .sorted { lhs, rhs in
                        let l = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey])
                            .contentModificationDate) ?? .distantPast
                        let r = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey])
                            .contentModificationDate) ?? .distantPast
                        return l > r
                    }
                    .first
                if let latest {
                    return latest.appendingPathComponent("rendered-diagnostic-states.txt")
                }
            }
            url = url.deletingLastPathComponent()
            if url.path == "/" { break }
        }
        return nil
    }

    // MARK: - Helpers

    private func makeTempProjectDir() throws -> URL {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("kota-diag-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return tmp
    }

    private func writeControlFile(in projectDir: URL, port: Int, pid: Int) throws {
        let kotaDir = projectDir.appendingPathComponent(".kota")
        try FileManager.default.createDirectory(at: kotaDir, withIntermediateDirectories: true)
        let path = kotaDir.appendingPathComponent("daemon-control.json")
        let body = """
        {"port": \(port), "pid": \(pid), "startedAt": "2026-04-29T00:00:00Z", "token": "REDACTED-TEST-TOKEN"}
        """
        try body.data(using: .utf8)!.write(to: path)
    }
}
