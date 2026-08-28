import XCTest
@testable import KotaShared

/// Exercises the operator-facing connection classification as a pure decision.
final class DaemonConnectionDiagnosticTests: XCTestCase {

    // MARK: - Local-mode classification

    func testNoScopeWhenSelectedDirIsNil() {
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: nil,
            controlFileState: .missing,
            identityProbe: nil
        )
        XCTAssertEqual(diag, .noScope)
        XCTAssertFalse(diag.isConnected)
        XCTAssertEqual(diag.severity, .info)
        XCTAssertEqual(diag.headline, "No scope selected")
    }

    func testNoControlFileWhenScopeHasNoLock() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/other-scope")
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
            controlFileState: .missing,
            identityProbe: nil
        )
        XCTAssertEqual(diag, .noControlFile(scopeRoot: dir.path))
        XCTAssertFalse(diag.isConnected)
        XCTAssertEqual(diag.headline, "No daemon for other-scope")
        XCTAssertTrue(diag.detail.contains("daemon-control.json is missing"))
    }

    func testUnreadableControlFile() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
            controlFileState: .unreadable,
            identityProbe: nil
        )
        XCTAssertEqual(diag, .unreadableControlFile(scopeRoot: dir.path))
        XCTAssertEqual(diag.severity, .warn)
    }

    func testStaleControlFileFlagsPidGone() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
            controlFileState: .stale(port: 8765, pid: 99999),
            identityProbe: nil
        )
        XCTAssertEqual(
            diag,
            .staleControlFile(scopeRoot: dir.path, pid: 99999, baseURL: "http://127.0.0.1:8765")
        )
        XCTAssertEqual(diag.severity, .warn)
        XCTAssertTrue(diag.headline.contains("Stale daemon"))
        XCTAssertTrue(diag.headline.contains("99999"))
        XCTAssertTrue(diag.detail.contains("kota doctor --fix"))
    }

    func testFreshControlFileButIdentityProbeNeverRanIsUnreachable() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
            controlFileState: .fresh(port: 8765, pid: 12345),
            identityProbe: nil
        )
        XCTAssertEqual(
            diag,
            .unreachable(scopeRoot: dir.path, baseURL: "http://127.0.0.1:8765", pid: 12345)
        )
        XCTAssertEqual(diag.severity, .error)
        XCTAssertTrue(diag.detail.contains("pid 12345"))
    }

    func testFreshControlFileWithUnreachableProbe() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/kota")
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
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
            selectedScopeDir: dir,
            controlFileState: .fresh(port: 8765, pid: 1),
            identityProbe: .tokenRejected(status: 401)
        )
        XCTAssertEqual(
            diag,
            .tokenRejected(scopeRoot: dir.path, baseURL: "http://127.0.0.1:8765", status: 401)
        )
        XCTAssertEqual(diag.severity, .warn)
        XCTAssertTrue(diag.headline.contains("HTTP 401"))
    }

    func testWrongScopeMismatchAfterIdentityProbe() {
        let selected = URL(fileURLWithPath: "/Users/op/Desktop/other-app")
        let identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: "/Users/op/Desktop/mono/apps/kota",
            scopeRegistry: scopeRegistry(
                defaultScopeId: "p-test",
                scopes: [
                    directoryScope(scopeId: "p-test", scopeRoot: "/Users/op/Desktop/mono/apps/kota", displayName: "kota")
                ]
            ),
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .unavailable(reason: "module_disabled", message: nil)
        )
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: selected,
            controlFileState: .fresh(port: 8765, pid: 4242),
            identityProbe: .ok(identity)
        )
        XCTAssertEqual(
            diag,
            .wrongScope(
                selectedDir: selected.path,
                daemonScopeName: "kota",
                daemonScopeDir: identity.scopeRoot,
                baseURL: "http://127.0.0.1:8765"
            )
        )
        XCTAssertEqual(diag.severity, .warn)
        XCTAssertEqual(diag.headline, "Wrong scope — daemon is on kota")
        XCTAssertTrue(diag.detail.contains(selected.path))
        XCTAssertTrue(diag.detail.contains(identity.scopeRoot))
    }

    func testConnectedWhenIdentityMatchesSelectedScopeDir() {
        let dir = URL(fileURLWithPath: "/Users/op/Desktop/mono/apps/kota")
        let identity = ClientIdentity(
            scopeName: "kota",
            scopeRoot: dir.path,
            scopeRegistry: scopeRegistry(
                defaultScopeId: "p-test",
                scopes: [directoryScope(scopeId: "p-test", scopeRoot: dir.path, displayName: "kota")]
            ),
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        let diag = deriveLocalDaemonDiagnostic(
            selectedScopeDir: dir,
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
            scopeName: "kota",
            scopeRoot: "/srv/kota",
            scopeRegistry: scopeRegistry(
                defaultScopeId: "p-test",
                scopes: [
                    directoryScope(scopeId: "p-test", scopeRoot: "/Users/op/Desktop/mono/apps/kota", displayName: "kota")
                ]
            ),
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
        let tmp = try makeTempScopeDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        XCTAssertEqual(classifyDaemonControlFile(scopeRoot: tmp), .missing)
    }

    func testClassifyDaemonControlFileFresh() throws {
        let tmp = try makeTempScopeDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        try writeControlFile(in: tmp, port: 8765, pid: 4242)
        let state = classifyDaemonControlFile(
            scopeRoot: tmp,
            processIsAlive: { $0 == 4242 }
        )
        XCTAssertEqual(state, .fresh(port: 8765, pid: 4242))
    }

    func testClassifyDaemonControlFileStale() throws {
        let tmp = try makeTempScopeDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        try writeControlFile(in: tmp, port: 8765, pid: 99999)
        let state = classifyDaemonControlFile(
            scopeRoot: tmp,
            processIsAlive: { _ in false }
        )
        XCTAssertEqual(state, .stale(port: 8765, pid: 99999))
    }

    func testClassifyDaemonControlFileUnreadableJSON() throws {
        let tmp = try makeTempScopeDir()
        defer { try? FileManager.default.removeItem(at: tmp) }
        let kotaDir = tmp.appendingPathComponent(".kota")
        try FileManager.default.createDirectory(at: kotaDir, withIntermediateDirectories: true)
        let path = kotaDir.appendingPathComponent("daemon-control.json")
        try "<not json>".data(using: .utf8)!.write(to: path)
        let state = classifyDaemonControlFile(scopeRoot: tmp)
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
            scopeName: "kota",
            scopeRoot: dir.path,
            scopeRegistry: scopeRegistry(
                defaultScopeId: "p-test",
                scopes: [directoryScope(scopeId: "p-test", scopeRoot: dir.path, displayName: "kota")]
            ),
            daemonVersion: "0.1.0",
            pid: 4242,
            startedAt: "2026-04-29T00:00:00Z",
            dashboard: .available(path: "/")
        )
        let cases: [DaemonConnectionDiagnostic] = [
            .noScope,
            .noControlFile(scopeRoot: dir.path),
            .unreadableControlFile(scopeRoot: dir.path),
            .staleControlFile(scopeRoot: dir.path, pid: 1, baseURL: "http://127.0.0.1:8765"),
            .unreachable(scopeRoot: dir.path, baseURL: "http://127.0.0.1:8765", pid: 1),
            .tokenRejected(scopeRoot: dir.path, baseURL: "http://127.0.0.1:8765", status: 401),
            .wrongScope(
                selectedDir: dir.path,
                daemonScopeName: "kota",
                daemonScopeDir: "/srv/kota",
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

    // MARK: - Helpers

    private func makeTempScopeDir() throws -> URL {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("kota-diag-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return tmp
    }

    private func writeControlFile(in scopeRoot: URL, port: Int, pid: Int) throws {
        let kotaDir = scopeRoot.appendingPathComponent(".kota")
        try FileManager.default.createDirectory(at: kotaDir, withIntermediateDirectories: true)
        let path = kotaDir.appendingPathComponent("daemon-control.json")
        let body = """
        {"port": \(port), "pid": \(pid), "startedAt": "2026-04-29T00:00:00Z", "token": "REDACTED-TEST-TOKEN"}
        """
        try body.data(using: .utf8)!.write(to: path)
    }
}
