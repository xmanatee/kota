import XCTest
@testable import KotaShared

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

}
