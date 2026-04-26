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

    func testFetchOwnerQuestionsDecodesMockedResponse() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/owner-questions")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let body = #"""
            {"questions": [{"id": "oq-1", "context": "c", "question": "q?", "reason": "r", "source": "builder", "createdAt": "t", "status": "pending"}]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let resp = try await client.fetchOwnerQuestions()
        XCTAssertEqual(resp.questions.count, 1)
        XCTAssertEqual(resp.questions[0].id, "oq-1")
    }

    func testAnswerOwnerQuestionSendsAnswerBody() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/owner-questions/oq-1/answer")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["answer"] as? String, "go ahead")
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil
            )!
            return (response, Data())
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")
        try await client.answerOwnerQuestion(id: "oq-1", answer: "go ahead")
    }

    func testDismissOwnerQuestionSendsReasonBody() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/owner-questions/oq-1/dismiss")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["reason"] as? String, "stale")
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil
            )!
            return (response, Data())
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")
        try await client.dismissOwnerQuestion(id: "oq-1", reason: "stale")
    }

    func testVoiceTranscribeSuccessReturnsText() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/voice/transcribe")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["mimeType"] as? String, "audio/mp4")
            XCTAssertEqual(obj?["filename"] as? String, "clip.m4a")
            // base64 of [1,2,3] is AQID
            XCTAssertEqual(obj?["audioBase64"] as? String, "AQID")
            let respBody = #"{"text": "hello macos", "language": "en"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")
        let result = try await client.voiceTranscribe(
            audio: Data([1, 2, 3]),
            mimeType: "audio/mp4",
            filename: "clip.m4a"
        )
        switch result {
        case .success(let text, let language):
            XCTAssertEqual(text, "hello macos")
            XCTAssertEqual(language, "en")
        case .failure:
            XCTFail("expected success")
        }
    }

    func testVoiceTranscribeSurfacesTypedCodeOn503() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let respBody = #"""
            {"error": "No transcription provider is registered", "code": "stt-unavailable"}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")
        let result = try await client.voiceTranscribe(audio: Data([1]), mimeType: "audio/mp4")
        switch result {
        case .success:
            XCTFail("expected failure")
        case .failure(let failure):
            XCTAssertEqual(failure.status, 503)
            XCTAssertEqual(failure.code, "stt-unavailable")
            XCTAssertEqual(failure.error, "No transcription provider is registered")
        }
    }

    func testVoiceSynthesizeSuccessReturnsAudio() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/voice/synthesize")
            XCTAssertEqual(request.httpMethod, "POST")
            // base64 of [9,8,7,6] is CQgHBg==
            let respBody = #"""
            {"audioBase64": "CQgHBg==", "mimeType": "audio/mpeg", "format": "mp3"}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")
        let result = try await client.voiceSynthesize(text: "speak me")
        switch result {
        case .success(let audio, let mimeType, let format):
            XCTAssertEqual(audio, Data([9, 8, 7, 6]))
            XCTAssertEqual(mimeType, "audio/mpeg")
            XCTAssertEqual(format, "mp3")
        case .failure:
            XCTFail("expected success")
        }
    }

    func testVoiceSynthesizeSurfacesFormatUnsupported() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let respBody = #"""
            {"error": "Format flac not supported by provider", "code": "tts-format-unsupported", "supported": ["mp3", "wav"]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 400, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")
        let result = try await client.voiceSynthesize(text: "x", format: "flac")
        switch result {
        case .success:
            XCTFail("expected failure")
        case .failure(let failure):
            XCTAssertEqual(failure.status, 400)
            XCTAssertEqual(failure.code, "tts-format-unsupported")
            XCTAssertEqual(failure.supportedFormats, ["mp3", "wav"])
        }
    }

    func testFetchDigestDecodesActivePayload() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/digest")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let body = #"""
            {
              "data": {
                "windowStartedAt": "2026-04-25T08:00:00.000Z",
                "windowEndedAt": "2026-04-26T08:00:00.000Z",
                "builderCommits": [{
                  "runId": "r-1",
                  "taskId": "task-foo",
                  "taskTitle": "Add foo",
                  "commitSubject": "Add foo",
                  "durationMs": 60000
                }],
                "explorerAdditions": [],
                "decomposerSplits": [],
                "blockedPromoterMoves": [],
                "failedMonitoredRuns": [],
                "pendingOwnerQuestions": [],
                "agingOperatorCaptures": [],
                "queueDelta": {
                  "current": {"backlog": 0, "ready": 1, "doing": 0, "blocked": 8},
                  "previous": null,
                  "delta": {"backlog": null, "ready": null, "doing": null, "blocked": null}
                },
                "quiet": false
              },
              "text": "Daily digest 2026-04-26\n- builder committed: Add foo"
            }
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let resp = try await client.fetchDigest()
        XCTAssertEqual(resp.data.quiet, false)
        XCTAssertEqual(resp.data.builderCommits.count, 1)
        XCTAssertEqual(resp.data.builderCommits[0].taskId, "task-foo")
        XCTAssertEqual(resp.data.builderCommits[0].taskTitle, "Add foo")
        XCTAssertEqual(resp.data.queueDelta.current.ready, 1)
        XCTAssertEqual(resp.data.queueDelta.current.blocked, 8)
        XCTAssertNil(resp.data.queueDelta.previous)
        XCTAssertNil(resp.data.queueDelta.delta.ready)
        XCTAssertTrue(resp.text.contains("builder committed: Add foo"))
    }

    func testFetchDigestDecodesQuietPayload() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"""
            {
              "data": {
                "windowStartedAt": "2026-04-25T08:00:00.000Z",
                "windowEndedAt": "2026-04-26T08:00:00.000Z",
                "builderCommits": [],
                "explorerAdditions": [],
                "decomposerSplits": [],
                "blockedPromoterMoves": [],
                "failedMonitoredRuns": [],
                "pendingOwnerQuestions": [],
                "agingOperatorCaptures": [],
                "queueDelta": {
                  "current": {"backlog": 0, "ready": 0, "doing": 0, "blocked": 0},
                  "previous": null,
                  "delta": {"backlog": null, "ready": null, "doing": null, "blocked": null}
                },
                "quiet": true
              },
              "text": "Daily digest 2026-04-26\n(quiet window — nothing to report)"
            }
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let resp = try await client.fetchDigest()
        XCTAssertTrue(resp.data.quiet)
        XCTAssertEqual(resp.data.builderCommits.count, 0)
        XCTAssertTrue(resp.text.contains("quiet window"))
    }

    func testFetchDigestSurfacesHttpErrorOneToOne() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"error": "windowEndMs must be a finite number"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 400, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.fetchDigest()
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 400)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testFetchAttentionDecodesActivePayload() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/attention")
            XCTAssertEqual(request.httpMethod ?? "GET", "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let body = #"""
            {
              "data": {
                "items": [
                  {"label": "Empty ready queue", "detail": "Builder has nothing to pull."}
                ]
              },
              "text": "Attention digest (1 item):\n• *Empty ready queue*: Builder has nothing to pull."
            }
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let resp = try await client.fetchAttention()
        XCTAssertEqual(resp.data.items.count, 1)
        XCTAssertEqual(resp.data.items[0].label, "Empty ready queue")
        XCTAssertEqual(resp.data.items[0].detail, "Builder has nothing to pull.")
        XCTAssertTrue(resp.text.contains("Attention digest (1 item):"))
    }

    func testFetchAttentionDecodesEmptyPayload() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/attention")
            let body = #"""
            {"data": {"items": []}, "text": "No attention items right now."}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let resp = try await client.fetchAttention()
        XCTAssertTrue(resp.data.items.isEmpty)
        XCTAssertEqual(resp.text, "No attention items right now.")
    }

    func testFetchAttentionSurfacesHttpErrorOneToOne() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"error": "boom"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.fetchAttention()
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 500)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testSearchKnowledgeDecodesSuccessfulEntries() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/knowledge/search")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let items = comps?.queryItems ?? []
            XCTAssertEqual(items.first(where: { $0.name == "q" })?.value, "hello world")
            XCTAssertEqual(items.first(where: { $0.name == "semantic" })?.value, "true")
            XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "10")
            let body = #"""
            {"ok": true, "entries": [
              {"id": "k-1", "type": "note", "status": "active", "title": "Knowledge surface fan-out"},
              {"id": "k-2", "type": "decision", "status": "archived", "title": "Operator-pull parity"}
            ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchKnowledge(query: "hello world", limit: 10)
        switch result {
        case .success(let entries):
            XCTAssertEqual(entries.count, 2)
            XCTAssertEqual(entries[0].id, "k-1")
            XCTAssertEqual(entries[0].type, "note")
            XCTAssertEqual(entries[0].status, "active")
            XCTAssertEqual(entries[0].title, "Knowledge surface fan-out")
            XCTAssertEqual(entries[1].id, "k-2")
            XCTAssertEqual(entries[1].type, "decision")
            XCTAssertEqual(entries[1].status, "archived")
            XCTAssertEqual(entries[1].title, "Operator-pull parity")
        case .semanticUnavailable:
            XCTFail("expected success branch")
        }
    }

    func testSearchKnowledgeDecodesEmptyEntries() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/knowledge/search")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let items = comps?.queryItems ?? []
            XCTAssertEqual(items.first(where: { $0.name == "q" })?.value, "no-match")
            XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "5")
            let body = #"{"ok": true, "entries": []}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchKnowledge(query: "no-match", limit: 5)
        switch result {
        case .success(let entries):
            XCTAssertTrue(entries.isEmpty)
        case .semanticUnavailable:
            XCTFail("expected empty success branch")
        }
    }

    func testSearchKnowledgeDecodesSemanticUnavailable() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/knowledge/search")
            let body = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchKnowledge(query: "anything", limit: 10)
        switch result {
        case .success:
            XCTFail("expected semanticUnavailable branch")
        case .semanticUnavailable:
            break
        }
    }

    func testSearchKnowledgeSurfacesHttpErrorOneToOne() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"error": "boom"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.searchKnowledge(query: "x", limit: 10)
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 500)
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
