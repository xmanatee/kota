import XCTest
@testable import KotaMenuBar

@MainActor
final class DaemonClientTests: XCTestCase {
    func testRefreshConnectionReadsControlFile() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("kota-tests-\(UUID().uuidString)")
        let kotaDir = tempDir.appendingPathComponent(".kota")
        try FileManager.default.createDirectory(at: kotaDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let controlPath = kotaDir.appendingPathComponent("daemon-control.json")
        let payload = #"{"port": 8765, "pid": 99, "startedAt": "2026-04-16T00:00:00Z", "token": "tok-xyz"}"#
        try payload.write(to: controlPath, atomically: true, encoding: .utf8)

        let client = DaemonClient()
        XCTAssertTrue(client.refreshConnection(projectDir: tempDir))
        XCTAssertEqual(client.connection?.baseURL.absoluteString, "http://127.0.0.1:8765")
        XCTAssertEqual(client.connection?.token, "tok-xyz")
    }

    func testRefreshConnectionReturnsFalseWhenControlFileMissing() {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("kota-tests-\(UUID().uuidString)")
        let client = DaemonClient()
        XCTAssertFalse(client.refreshConnection(projectDir: tempDir))
        XCTAssertNil(client.connection)
    }

    func testRefreshConnectionReturnsFalseOnMalformedControlFile() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("kota-tests-\(UUID().uuidString)")
        let kotaDir = tempDir.appendingPathComponent(".kota")
        try FileManager.default.createDirectory(at: kotaDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let controlPath = kotaDir.appendingPathComponent("daemon-control.json")
        try "not json".write(to: controlPath, atomically: true, encoding: .utf8)

        let client = DaemonClient()
        XCTAssertFalse(client.refreshConnection(projectDir: tempDir))
        XCTAssertNil(client.connection)
    }

    func testSetRemoteConnection() throws {
        let client = DaemonClient()
        let url = URL(string: "https://daemon.example.com")!
        client.setRemoteConnection(url: url, token: "remote-token")
        XCTAssertEqual(client.connection?.baseURL, url)
        XCTAssertEqual(client.connection?.token, "remote-token")
    }

    func testFetchStatusThrowsWhenNotConnected() async {
        let client = DaemonClient()
        do {
            _ = try await client.fetchStatus()
            XCTFail("expected notConnected error")
        } catch DaemonClientError.notConnected {
            // expected
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testFetchStatusDecodesMockedResponse() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/status")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let body = #"{"running": true, "workflow": {"activeRuns": [], "paused": false}}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let status = try await client.fetchStatus()
        XCTAssertTrue(status.running)
        XCTAssertEqual(status.workflow?.activeRuns.count, 0)
    }

    func testFetchStatusThrowsOnHttpError() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil
            )!
            return (response, Data())
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.fetchStatus()
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 401)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testTriggerWorkflowSendsBody() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/workflow/trigger")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            XCTAssertNotNil(body)
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["workflow"] as? String, "builder")

            let respBody = #"{"runId": "run-1"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        let resp = try await client.triggerWorkflow(name: "builder")
        XCTAssertEqual(resp.runId, "run-1")
    }
}

// MARK: - URL protocol mock

final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "MockURLProtocol", code: -1))
            return
        }
        let (response, data) = handler(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private extension URLRequest {
    func readBody() -> Data? {
        if let body = httpBody { return body }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
