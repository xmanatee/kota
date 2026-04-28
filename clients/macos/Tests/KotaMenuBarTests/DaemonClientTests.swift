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

    func testSearchMemoryDecodesSuccessfulEntries() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/memory/search")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let items = comps?.queryItems ?? []
            XCTAssertEqual(items.first(where: { $0.name == "q" })?.value, "hello world")
            XCTAssertEqual(items.first(where: { $0.name == "semantic" })?.value, "true")
            XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "10")
            let body = #"""
            {"ok": true, "entries": [
              {"id": "m-1", "created": "2026-04-26T12:34:56Z", "content": "Memory surface fan-out"},
              {"id": "m-2", "created": "2026-04-25T08:00:00Z", "content": "Operator-pull parity"}
            ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchMemory(query: "hello world", limit: 10)
        switch result {
        case .success(let entries):
            XCTAssertEqual(entries.count, 2)
            XCTAssertEqual(entries[0].id, "m-1")
            XCTAssertEqual(entries[0].created, "2026-04-26T12:34:56Z")
            XCTAssertEqual(entries[0].content, "Memory surface fan-out")
            XCTAssertEqual(entries[1].id, "m-2")
            XCTAssertEqual(entries[1].created, "2026-04-25T08:00:00Z")
            XCTAssertEqual(entries[1].content, "Operator-pull parity")
        case .semanticUnavailable:
            XCTFail("expected success branch")
        }
    }

    func testSearchMemoryDecodesEmptyEntries() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/memory/search")
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

        let result = try await client.searchMemory(query: "no-match", limit: 5)
        switch result {
        case .success(let entries):
            XCTAssertTrue(entries.isEmpty)
        case .semanticUnavailable:
            XCTFail("expected empty success branch")
        }
    }

    func testSearchMemoryDecodesSemanticUnavailable() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/memory/search")
            let body = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchMemory(query: "anything", limit: 10)
        switch result {
        case .success:
            XCTFail("expected semanticUnavailable branch")
        case .semanticUnavailable:
            break
        }
    }

    func testSearchMemorySurfacesHttpErrorOneToOne() async throws {
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
            _ = try await client.searchMemory(query: "x", limit: 10)
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 500)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testSearchHistoryDecodesSuccessfulConversations() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/history/search")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let items = comps?.queryItems ?? []
            XCTAssertEqual(items.first(where: { $0.name == "q" })?.value, "hello world")
            XCTAssertEqual(items.first(where: { $0.name == "semantic" })?.value, "true")
            XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "10")
            let body = #"""
            {"ok": true, "conversations": [
              {
                "id": "c-1",
                "title": "History surface fan-out",
                "createdAt": "2026-04-26T12:00:00Z",
                "updatedAt": "2026-04-26T12:34:56Z",
                "model": "claude-opus-4-7",
                "messageCount": 12,
                "cwd": "/repo",
                "source": "user"
              },
              {
                "id": "c-2",
                "title": "Operator-pull parity",
                "createdAt": "2026-04-25T08:00:00Z",
                "updatedAt": "2026-04-25T09:30:00Z",
                "model": "claude-sonnet-4-6",
                "messageCount": 4,
                "cwd": "/repo"
              }
            ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchHistory(query: "hello world", limit: 10)
        switch result {
        case .success(let conversations):
            XCTAssertEqual(conversations.count, 2)
            XCTAssertEqual(conversations[0].id, "c-1")
            XCTAssertEqual(conversations[0].title, "History surface fan-out")
            XCTAssertEqual(conversations[0].createdAt, "2026-04-26T12:00:00Z")
            XCTAssertEqual(conversations[0].updatedAt, "2026-04-26T12:34:56Z")
            XCTAssertEqual(conversations[0].model, "claude-opus-4-7")
            XCTAssertEqual(conversations[0].messageCount, 12)
            XCTAssertEqual(conversations[0].cwd, "/repo")
            XCTAssertEqual(conversations[0].source, "user")
            XCTAssertEqual(conversations[1].id, "c-2")
            XCTAssertEqual(conversations[1].messageCount, 4)
            XCTAssertNil(conversations[1].source)
        case .semanticUnavailable:
            XCTFail("expected success branch")
        }
    }

    func testSearchHistoryDecodesEmptyConversations() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/history/search")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let items = comps?.queryItems ?? []
            XCTAssertEqual(items.first(where: { $0.name == "q" })?.value, "no-match")
            XCTAssertEqual(items.first(where: { $0.name == "semantic" })?.value, "true")
            XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "5")
            let body = #"{"ok": true, "conversations": []}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchHistory(query: "no-match", limit: 5)
        switch result {
        case .success(let conversations):
            XCTAssertTrue(conversations.isEmpty)
        case .semanticUnavailable:
            XCTFail("expected empty success branch")
        }
    }

    func testSearchHistoryDecodesSemanticUnavailable() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/history/search")
            let body = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchHistory(query: "anything", limit: 10)
        switch result {
        case .success:
            XCTFail("expected semanticUnavailable branch")
        case .semanticUnavailable:
            break
        }
    }

    func testSearchHistorySurfacesHttpErrorOneToOne() async throws {
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
            _ = try await client.searchHistory(query: "x", limit: 10)
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 500)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testSearchTasksDecodesSuccessfulTasks() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/tasks/search")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let items = comps?.queryItems ?? []
            XCTAssertEqual(items.first(where: { $0.name == "q" })?.value, "hello world")
            XCTAssertEqual(items.first(where: { $0.name == "semantic" })?.value, "true")
            XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "10")
            let stateValues = items.filter { $0.name == "state" }.compactMap { $0.value }
            XCTAssertEqual(stateValues, ["ready", "doing"])
            let body = #"""
            {"ok": true, "tasks": [
              {
                "id": "task-foo",
                "title": "Tasks surface fan-out",
                "state": "ready",
                "priority": "p2",
                "area": "client",
                "summary": "Wire the macOS DaemonClient",
                "updatedAt": "2026-04-26T12:34:56Z",
                "score": 0.91
              },
              {
                "id": "task-bar",
                "title": "Operator-pull parity",
                "state": "doing",
                "priority": "p1",
                "area": "client",
                "summary": "Mobile screen",
                "updatedAt": "2026-04-25T08:00:00Z",
                "score": 0.42
              }
            ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchTasks(query: "hello world", limit: 10, states: ["ready", "doing"])
        switch result {
        case .success(let tasks):
            XCTAssertEqual(tasks.count, 2)
            XCTAssertEqual(tasks[0].id, "task-foo")
            XCTAssertEqual(tasks[0].title, "Tasks surface fan-out")
            XCTAssertEqual(tasks[0].state, "ready")
            XCTAssertEqual(tasks[0].priority, "p2")
            XCTAssertEqual(tasks[0].area, "client")
            XCTAssertEqual(tasks[0].summary, "Wire the macOS DaemonClient")
            XCTAssertEqual(tasks[0].updatedAt, "2026-04-26T12:34:56Z")
            XCTAssertEqual(tasks[0].score, 0.91, accuracy: 1e-6)
            XCTAssertEqual(tasks[1].id, "task-bar")
            XCTAssertEqual(tasks[1].state, "doing")
            XCTAssertEqual(tasks[1].priority, "p1")
        case .semanticUnavailable:
            XCTFail("expected success branch")
        }
    }

    func testSearchTasksDecodesEmptyTasks() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/tasks/search")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let items = comps?.queryItems ?? []
            XCTAssertEqual(items.first(where: { $0.name == "q" })?.value, "no-match")
            XCTAssertEqual(items.first(where: { $0.name == "semantic" })?.value, "true")
            XCTAssertEqual(items.first(where: { $0.name == "limit" })?.value, "5")
            XCTAssertTrue(items.filter { $0.name == "state" }.isEmpty)
            let body = #"{"ok": true, "tasks": []}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchTasks(query: "no-match", limit: 5, states: nil)
        switch result {
        case .success(let tasks):
            XCTAssertTrue(tasks.isEmpty)
        case .semanticUnavailable:
            XCTFail("expected empty success branch")
        }
    }

    func testSearchTasksDecodesSemanticUnavailable() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/tasks/search")
            let body = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.searchTasks(query: "anything", limit: 10, states: nil)
        switch result {
        case .success:
            XCTFail("expected semanticUnavailable branch")
        case .semanticUnavailable:
            break
        }
    }

    func testSearchTasksSurfacesHttpErrorOneToOne() async throws {
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
            _ = try await client.searchTasks(query: "x", limit: 10, states: nil)
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 500)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testRecallDecodesMixedSourceSuccess() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/recall")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = request.readBody()
            XCTAssertNotNil(body)
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["query"] as? String, "recall me")
            let filter = obj?["filter"] as? [String: Any]
            XCTAssertEqual(filter?["topK"] as? Int, 5)
            XCTAssertEqual(filter?["minScore"] as? Double, 0.25)
            XCTAssertEqual(filter?["sources"] as? [String], ["knowledge", "memory"])
            let respBody = #"""
            {"ok": true, "hits": [
              {
                "source": "knowledge",
                "score": 0.91,
                "id": "k-1",
                "title": "Knowledge surface fan-out",
                "preview": "Cross-store recall seam preview",
                "updated": "2026-04-26T12:34:56Z"
              },
              {
                "source": "memory",
                "score": 0.72,
                "id": "m-1",
                "preview": "Operator-pull parity",
                "created": "2026-04-25T08:00:00Z"
              },
              {
                "source": "history",
                "score": 0.55,
                "id": "c-1",
                "title": "Recall design discussion",
                "cwd": "/repo",
                "updatedAt": "2026-04-24T08:00:00Z"
              },
              {
                "source": "tasks",
                "score": 0.42,
                "id": "task-foo",
                "title": "Wire macOS recall",
                "state": "ready",
                "priority": "p2",
                "updatedAt": "2026-04-23T08:00:00Z"
              }
            ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.recall(
            query: "recall me",
            topK: 5,
            minScore: 0.25,
            sources: ["knowledge", "memory"]
        )
        switch result {
        case .success(let hits):
            XCTAssertEqual(hits.count, 4)
            guard case let .knowledge(score, id, title, preview, updated) = hits[0] else {
                XCTFail("expected knowledge arm at [0], got \(hits[0])"); return
            }
            XCTAssertEqual(score, 0.91, accuracy: 1e-6)
            XCTAssertEqual(id, "k-1")
            XCTAssertEqual(title, "Knowledge surface fan-out")
            XCTAssertEqual(preview, "Cross-store recall seam preview")
            XCTAssertEqual(updated, "2026-04-26T12:34:56Z")
            guard case let .memory(_, mid, mpreview, mcreated) = hits[1] else {
                XCTFail("expected memory arm at [1], got \(hits[1])"); return
            }
            XCTAssertEqual(mid, "m-1")
            XCTAssertEqual(mpreview, "Operator-pull parity")
            XCTAssertEqual(mcreated, "2026-04-25T08:00:00Z")
            guard case let .history(_, hid, htitle, hcwd, hupdated) = hits[2] else {
                XCTFail("expected history arm at [2], got \(hits[2])"); return
            }
            XCTAssertEqual(hid, "c-1")
            XCTAssertEqual(htitle, "Recall design discussion")
            XCTAssertEqual(hcwd, "/repo")
            XCTAssertEqual(hupdated, "2026-04-24T08:00:00Z")
            guard case let .tasks(_, tid, ttitle, tstate, tpriority, tupdated) = hits[3] else {
                XCTFail("expected tasks arm at [3], got \(hits[3])"); return
            }
            XCTAssertEqual(tid, "task-foo")
            XCTAssertEqual(ttitle, "Wire macOS recall")
            XCTAssertEqual(tstate, "ready")
            XCTAssertEqual(tpriority, "p2")
            XCTAssertEqual(tupdated, "2026-04-23T08:00:00Z")
        case .semanticUnavailable:
            XCTFail("expected success branch")
        }
    }

    func testRecallDecodesEmptyHits() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/recall")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            XCTAssertNotNil(body)
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["query"] as? String, "no-match")
            // nil topK / minScore / sources omit those keys entirely so the
            // seam applies its own typed defaults.
            let filter = obj?["filter"] as? [String: Any]
            XCTAssertNotNil(filter)
            XCTAssertNil(filter?["topK"])
            XCTAssertNil(filter?["minScore"])
            XCTAssertNil(filter?["sources"])
            let respBody = #"{"ok": true, "hits": []}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.recall(query: "no-match", topK: nil, minScore: nil, sources: nil)
        switch result {
        case .success(let hits):
            XCTAssertTrue(hits.isEmpty)
        case .semanticUnavailable:
            XCTFail("expected empty success branch")
        }
    }

    func testRecallDecodesSemanticUnavailable() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/recall")
            let respBody = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.recall(query: "anything", topK: nil, minScore: nil, sources: nil)
        switch result {
        case .success:
            XCTFail("expected semanticUnavailable branch")
        case .semanticUnavailable:
            break
        }
    }

    func testRecallSurfacesHttpErrorOneToOne() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let respBody = #"{"error": "boom"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.recall(query: "x", topK: nil, minScore: nil, sources: nil)
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 500)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testAnswerDecodesSynthesizedSuccessAcrossArms() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/answer")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = request.readBody()
            XCTAssertNotNil(body)
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["query"] as? String, "what am i tracking about recall?")
            let filter = obj?["filter"] as? [String: Any]
            XCTAssertEqual(filter?["topK"] as? Int, 8)
            XCTAssertEqual(filter?["minScore"] as? Double, 0.3)
            XCTAssertEqual(filter?["sources"] as? [String], ["knowledge", "memory"])
            let respBody = #"""
            {"ok": true,
             "answer": "Recall is the cross-store seam [knowledge:k-1] used by every surface [memory:m-1].",
             "citations": [
               {"source": "knowledge", "id": "k-1"},
               {"source": "memory", "id": "m-1"}
             ],
             "hits": [
               {
                 "source": "knowledge",
                 "score": 0.91,
                 "id": "k-1",
                 "title": "Cross-store recall seam",
                 "preview": "Cross-store recall seam preview",
                 "updated": "2026-04-26T12:34:56Z"
               },
               {
                 "source": "memory",
                 "score": 0.72,
                 "id": "m-1",
                 "preview": "Operator-pull parity",
                 "created": "2026-04-25T08:00:00Z"
               }
             ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.answer(
            query: "what am i tracking about recall?",
            topK: 8,
            minScore: 0.3,
            sources: ["knowledge", "memory"]
        )
        switch result {
        case .success(let answer, let citations, let hits):
            XCTAssertEqual(
                answer,
                "Recall is the cross-store seam [knowledge:k-1] used by every surface [memory:m-1]."
            )
            XCTAssertEqual(citations.count, 2)
            XCTAssertEqual(citations[0].source, "knowledge")
            XCTAssertEqual(citations[0].id, "k-1")
            XCTAssertEqual(citations[1].source, "memory")
            XCTAssertEqual(citations[1].id, "m-1")
            XCTAssertEqual(hits.count, 2)
            guard case let .knowledge(score, id, title, preview, updated) = hits[0] else {
                XCTFail("expected knowledge arm at [0], got \(hits[0])"); return
            }
            XCTAssertEqual(score, 0.91, accuracy: 1e-6)
            XCTAssertEqual(id, "k-1")
            XCTAssertEqual(title, "Cross-store recall seam")
            XCTAssertEqual(preview, "Cross-store recall seam preview")
            XCTAssertEqual(updated, "2026-04-26T12:34:56Z")
            guard case let .memory(_, mid, mpreview, mcreated) = hits[1] else {
                XCTFail("expected memory arm at [1], got \(hits[1])"); return
            }
            XCTAssertEqual(mid, "m-1")
            XCTAssertEqual(mpreview, "Operator-pull parity")
            XCTAssertEqual(mcreated, "2026-04-25T08:00:00Z")
        case .noHits, .semanticUnavailable, .synthesisFailed:
            XCTFail("expected success branch")
        }
    }

    func testAnswerDecodesNoHits() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/answer")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            XCTAssertNotNil(body)
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["query"] as? String, "no-match")
            let filter = obj?["filter"] as? [String: Any]
            XCTAssertNotNil(filter)
            XCTAssertNil(filter?["topK"])
            XCTAssertNil(filter?["minScore"])
            XCTAssertNil(filter?["sources"])
            let respBody = #"{"ok": false, "reason": "no_hits"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.answer(query: "no-match", topK: nil, minScore: nil, sources: nil)
        switch result {
        case .noHits:
            break
        case .success, .semanticUnavailable, .synthesisFailed:
            XCTFail("expected noHits branch")
        }
    }

    func testAnswerDecodesSemanticUnavailable() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/answer")
            let respBody = #"{"ok": false, "reason": "semantic_unavailable"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.answer(query: "anything", topK: nil, minScore: nil, sources: nil)
        switch result {
        case .semanticUnavailable:
            break
        case .success, .noHits, .synthesisFailed:
            XCTFail("expected semanticUnavailable branch")
        }
    }

    func testAnswerDecodesSynthesisFailed() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/answer")
            let respBody = #"{"ok": false, "reason": "synthesis_failed"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.answer(query: "anything", topK: nil, minScore: nil, sources: nil)
        switch result {
        case .synthesisFailed:
            break
        case .success, .noHits, .semanticUnavailable:
            XCTFail("expected synthesisFailed branch")
        }
    }

    func testAnswerSurfacesHttpErrorOneToOne() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let respBody = #"{"error": "boom"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "t")

        do {
            _ = try await client.answer(query: "x", topK: nil, minScore: nil, sources: nil)
            XCTFail("expected httpError")
        } catch DaemonClientError.httpError(let code) {
            XCTAssertEqual(code, 500)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    /// Multi-arm success decode: a `tasks` record (carries `path`) plus a
    /// second decode of a `memory` record (no `path`) wired through the
    /// same harness so both record-shape variants are exercised. Also
    /// pins `renderCaptureResultPlain` byte-for-byte against the TS
    /// helper for both arms.
    func testCaptureDecodesSuccessAcrossArms() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        var nextResponse: Data = Data()
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/capture")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            let body = request.readBody()
            XCTAssertNotNil(body)
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["text"] as? String, "buy milk")
            let filter = obj?["filter"] as? [String: Any]
            XCTAssertEqual(filter?["target"] as? String, "tasks")
            XCTAssertEqual(filter?["hint"] as? String, "shopping")
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, nextResponse)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        // Tasks arm — carries path.
        nextResponse = #"""
        {"ok": true, "record": {
          "target": "tasks",
          "recordId": "task-buy-milk",
          "path": "data/tasks/ready/task-buy-milk.md"
        }}
        """#.data(using: .utf8)!
        let tasksResult = try await client.capture(
            text: "buy milk",
            target: .tasks,
            hint: "shopping"
        )
        guard case let .success(tasksRecord) = tasksResult else {
            XCTFail("expected success arm, got \(tasksResult)"); return
        }
        guard case let .tasks(tid, tpath) = tasksRecord else {
            XCTFail("expected tasks record, got \(tasksRecord)"); return
        }
        XCTAssertEqual(tid, "task-buy-milk")
        XCTAssertEqual(tpath, "data/tasks/ready/task-buy-milk.md")
        XCTAssertEqual(
            renderCaptureResultPlain(tasksResult),
            "Captured: tasks  task-buy-milk  data/tasks/ready/task-buy-milk.md"
        )

        // Memory arm — no path.
        nextResponse = #"""
        {"ok": true, "record": {
          "target": "memory",
          "recordId": "mem-42"
        }}
        """#.data(using: .utf8)!
        let memoryResult = try await client.capture(
            text: "buy milk",
            target: .tasks,
            hint: "shopping"
        )
        guard case let .success(memoryRecord) = memoryResult else {
            XCTFail("expected success arm, got \(memoryResult)"); return
        }
        guard case let .memory(mid) = memoryRecord else {
            XCTFail("expected memory record, got \(memoryRecord)"); return
        }
        XCTAssertEqual(mid, "mem-42")
        XCTAssertEqual(
            renderCaptureResultPlain(memoryResult),
            "Captured: memory  mem-42"
        )
    }

    func testCaptureDecodesAmbiguousPreservingOrder() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/capture")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            XCTAssertNotNil(body)
            let obj = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(obj?["text"] as? String, "ambiguous note")
            // nil target/hint omits the filter key entirely so the seam
            // applies its own typed defaults.
            XCTAssertNil(obj?["filter"])
            let respBody = #"""
            {"ok": false, "reason": "ambiguous", "suggestions": ["knowledge", "memory"]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.capture(text: "ambiguous note", target: nil, hint: nil)
        guard case let .ambiguous(suggestions) = result else {
            XCTFail("expected ambiguous arm, got \(result)"); return
        }
        XCTAssertEqual(suggestions, [.knowledge, .memory])
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Ambiguous capture. Re-run with --target <one of: knowledge, memory>."
        )
    }

    func testCaptureDecodesNoContributors() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/capture")
            let respBody = #"{"ok": false, "reason": "no_contributors"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.capture(text: "anything", target: nil, hint: nil)
        guard case .noContributors = result else {
            XCTFail("expected noContributors arm, got \(result)"); return
        }
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Cross-store capture has no registered contributors."
        )
    }

    func testCaptureDecodesContributorFailed() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/capture")
            let respBody = #"""
            {"ok": false, "reason": "contributor_failed", "target": "inbox", "message": "inbox writer cannot reach project root"}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, respBody)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")

        let result = try await client.capture(text: "boom", target: nil, hint: nil)
        guard case let .contributorFailed(target, message) = result else {
            XCTFail("expected contributorFailed arm, got \(result)"); return
        }
        XCTAssertEqual(target, .inbox)
        XCTAssertEqual(message, "inbox writer cannot reach project root")
        XCTAssertEqual(
            renderCaptureResultPlain(result),
            "Capture into inbox failed: inbox writer cannot reach project root"
        )
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
