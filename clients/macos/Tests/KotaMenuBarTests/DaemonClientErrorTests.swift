import XCTest
@testable import KotaMenuBar

@MainActor
final class DaemonClientErrorTests: XCTestCase {
    // MARK: - JSON body decoding

    func testDecodeDaemonErrorBodyParsesErrorAndCode() throws {
        let data = #"{"error": "Format flac not supported", "code": "tts-format-unsupported"}"#
            .data(using: .utf8)!
        let body = decodeDaemonErrorBody(from: data)
        XCTAssertEqual(body?.error, "Format flac not supported")
        XCTAssertEqual(body?.code, "tts-format-unsupported")
        XCTAssertNil(body?.reason)
        XCTAssertNil(body?.message)
    }

    func testDecodeDaemonErrorBodyParsesReason() throws {
        let data = #"{"reason": "semantic_unavailable"}"#.data(using: .utf8)!
        let body = decodeDaemonErrorBody(from: data)
        XCTAssertEqual(body?.reason, "semantic_unavailable")
        XCTAssertEqual(body?.displaySummary, "semantic_unavailable")
    }

    func testDecodeDaemonErrorBodyFallsBackToRawText() throws {
        let data = "<html>500</html>".data(using: .utf8)!
        let body = decodeDaemonErrorBody(from: data)
        XCTAssertNil(body?.error)
        XCTAssertEqual(body?.raw, "<html>500</html>")
        XCTAssertEqual(body?.displaySummary, "<html>500</html>")
    }

    func testDecodeDaemonErrorBodyReturnsNilForEmptyBody() throws {
        XCTAssertNil(decodeDaemonErrorBody(from: Data()))
    }

    // MARK: - LocalizedError text

    func testNotConnectedDescription() {
        let err: DaemonClientError = .notConnected
        XCTAssertEqual(err.localizedDescription, "Daemon offline — no connection configured.")
    }

    func testHTTPError401WithBodyMentionsToken() {
        let body = DaemonErrorBody(error: "Unauthorized", code: nil, reason: nil, message: nil, raw: nil)
        let err: DaemonClientError = .httpError(status: 401, body: body)
        XCTAssertEqual(err.localizedDescription, "Daemon rejected request (401): Unauthorized")
    }

    func testHTTPError401WithoutBodyExplainsToken() {
        let err: DaemonClientError = .httpError(status: 401, body: nil)
        XCTAssertEqual(
            err.localizedDescription,
            "Daemon rejected the request — token may be invalid or missing (HTTP 401)."
        )
    }

    func testHTTPError503ProviderUnavailableIncludesCode() {
        let body = DaemonErrorBody(
            error: "No transcription provider is registered",
            code: "stt-unavailable",
            reason: nil,
            message: nil,
            raw: nil
        )
        let err: DaemonClientError = .httpError(status: 503, body: body)
        XCTAssertEqual(
            err.localizedDescription,
            "Daemon unavailable: No transcription provider is registered [stt-unavailable]"
        )
    }

    func testHTTPError404UsesEndpointWording() {
        let err: DaemonClientError = .httpError(status: 404, body: nil)
        XCTAssertEqual(err.localizedDescription, "Daemon endpoint not found (HTTP 404).")
    }

    func testHTTPError500WithReasonOnly() {
        let body = DaemonErrorBody(
            error: nil,
            code: nil,
            reason: "embedding_unsupported",
            message: nil,
            raw: nil
        )
        let err: DaemonClientError = .httpError(status: 500, body: body)
        XCTAssertEqual(err.localizedDescription, "Daemon error (500): embedding_unsupported")
    }

    func testDecodingErrorPreservesUnderlyingDescription() {
        let err: DaemonClientError = .decodingError(description: "missing key foo")
        XCTAssertEqual(
            err.localizedDescription,
            "Daemon response did not match the expected shape: missing key foo"
        )
    }

    // MARK: - HTTP code path decodes JSON body

    func testFetchStatusOn401DecodesUnauthorizedBody() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"error": "Unauthorized"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "bad")

        do {
            _ = try await client.fetchStatus()
            XCTFail("expected httpError")
        } catch let DaemonClientError.httpError(status, body) {
            XCTAssertEqual(status, 401)
            XCTAssertEqual(body?.error, "Unauthorized")
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testFetchDigestOn503DecodesProviderUnavailable() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"error": "Daemon chat sessions not available"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.fetchDigest()
            XCTFail("expected httpError")
        } catch let DaemonClientError.httpError(status, body) {
            XCTAssertEqual(status, 503)
            XCTAssertEqual(body?.error, "Daemon chat sessions not available")
            XCTAssertEqual(
                DaemonClientError.httpError(status: status, body: body).localizedDescription,
                "Daemon unavailable: Daemon chat sessions not available"
            )
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testFetchDigestOnHTMLBodySurfacesRawText() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = "<html><body>500 Internal Error</body></html>".data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.fetchDigest()
            XCTFail("expected httpError")
        } catch let DaemonClientError.httpError(status, body) {
            XCTAssertEqual(status, 500)
            XCTAssertEqual(body?.raw, "<html><body>500 Internal Error</body></html>")
            XCTAssertNil(body?.error)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testFetchDigestOnDecodingDriftThrowsDecodingError() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            // 200 with a body that does not match DigestResponse: triggers decoding drift.
            let body = #"{"unexpected": true}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.fetchDigest()
            XCTFail("expected decodingError")
        } catch let DaemonClientError.decodingError(description) {
            XCTAssertFalse(description.isEmpty)
            XCTAssertTrue(
                DaemonClientError.decodingError(description: description).localizedDescription
                    .hasPrefix("Daemon response did not match the expected shape:")
            )
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    // MARK: - Presenter contract

    func testPresenterUsesDaemonClientErrorLocalizedDescription() {
        let body = DaemonErrorBody(error: "oops", code: "x", reason: nil, message: nil, raw: nil)
        let err: DaemonClientError = .httpError(status: 500, body: body)
        XCTAssertEqual(
            DaemonErrorPresenter.message(for: err),
            "Daemon error (500): oops [x]"
        )
    }

    func testPresenterPassesThroughGenericErrors() {
        struct GenericError: LocalizedError {
            var errorDescription: String? { "boom" }
        }
        XCTAssertEqual(DaemonErrorPresenter.message(for: GenericError()), "boom")
    }

    /// Writes the canonical rendered-text snapshot to the latest run
    /// directory under `.kota/runs/` (when present) so reviewers have a
    /// deterministic file showing exactly what a SwiftUI `Text(error)` would
    /// display for each scenario covered by this suite. This is a write-only
    /// side effect; no assertions depend on the file existing on disk.
    func testWritesRenderedErrorStringsSnapshot() throws {
        let snapshot = """
        # Rendered error strings (what views display via SwiftUI Text)
        # Generated by DaemonClientErrorTests.testWritesRenderedErrorStringsSnapshot

        notConnected:
          \(DaemonClientError.notConnected.localizedDescription)

        httpError 401 + {error: Unauthorized}:
          \(DaemonClientError.httpError(status: 401, body: DaemonErrorBody(error: "Unauthorized", code: nil, reason: nil, message: nil, raw: nil)).localizedDescription)

        httpError 401 + no body:
          \(DaemonClientError.httpError(status: 401, body: nil).localizedDescription)

        httpError 503 + {error, code: stt-unavailable}:
          \(DaemonClientError.httpError(status: 503, body: DaemonErrorBody(error: "No transcription provider is registered", code: "stt-unavailable", reason: nil, message: nil, raw: nil)).localizedDescription)

        httpError 404 + no body:
          \(DaemonClientError.httpError(status: 404, body: nil).localizedDescription)

        httpError 500 + {reason: embedding_unsupported}:
          \(DaemonClientError.httpError(status: 500, body: DaemonErrorBody(error: nil, code: nil, reason: "embedding_unsupported", message: nil, raw: nil)).localizedDescription)

        httpError 500 + raw HTML body:
          \(DaemonClientError.httpError(status: 500, body: DaemonErrorBody(error: nil, code: nil, reason: nil, message: nil, raw: "<html>500</html>")).localizedDescription)

        decodingError (success body drift):
          \(DaemonClientError.decodingError(description: "missing key foo").localizedDescription)
        """

        guard let snapshotURL = Self.snapshotPath() else { return }
        try? FileManager.default.createDirectory(
            at: snapshotURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try snapshot.write(to: snapshotURL, atomically: true, encoding: .utf8)
    }

    private static func snapshotPath() -> URL? {
        // Honor KOTA_RUN_DIR when the workflow injects it; otherwise pick the
        // most recent run directory under `.kota/runs/`. Returning nil simply
        // skips the write — this test is best-effort about producing artifacts.
        let env = ProcessInfo.processInfo.environment
        if let runDir = env["KOTA_RUN_DIR"], !runDir.isEmpty {
            return URL(fileURLWithPath: runDir).appendingPathComponent("rendered-error-strings.txt")
        }
        let fm = FileManager.default
        var url = URL(fileURLWithPath: fm.currentDirectoryPath)
        for _ in 0..<6 {
            let candidate = url.appendingPathComponent(".kota/runs")
            if let entries = try? fm.contentsOfDirectory(at: candidate, includingPropertiesForKeys: [.contentModificationDateKey]) {
                let latest = entries
                    .filter { $0.hasDirectoryPath }
                    .sorted { lhs, rhs in
                        let l = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                        let r = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                        return l > r
                    }
                    .first
                if let latest {
                    return latest.appendingPathComponent("rendered-error-strings.txt")
                }
            }
            url = url.deletingLastPathComponent()
            if url.path == "/" { break }
        }
        return nil
    }
}
