import XCTest
@testable import KotaShared

/// Coverage for the `AppState` answer-history view-model paths.
///
/// `AppState.loadAnswerLog`, `loadMoreAnswerLog`, `openAnswerShow`, and
/// `closeAnswerShow` are the seam between the SwiftUI surface
/// (`AnswerHistoryView`) and the daemon-control routes
/// (`DaemonClient.answerLog` / `DaemonClient.answerShow`). Each test
/// pins one observable transition the view depends on. The transport
/// layer is exercised through the same `MockURLProtocol` the
/// `DaemonClientTests` use, so the live state container is wired
/// against actual HTTP shaping rather than a hand-rolled stub.
@MainActor
final class AnswerHistoryStateTests: XCTestCase {

    private final class StubNotifications: NotificationManaging {
        func requestAuthorization() {}
        func notify(title: String, body: String, identifier: String) {}
    }

    private func makeState() -> AppState {
        UserDefaults.standard.removeObject(forKey: "projectDirectory")
        UserDefaults.standard.removeObject(forKey: "remoteDaemonURL")
        UserDefaults.standard.removeObject(forKey: "notificationsEnabled")
        let state = AppState(
            client: nil,
            notifications: StubNotifications(),
            startPollingOnInit: false
        )
        state.client.setRemoteConnection(
            url: URL(string: "http://127.0.0.1:8765")!,
            token: "test-token"
        )
        return state
    }

    // MARK: - loadAnswerLog

    /// Initial load pulls a full page, replaces any prior list, sets
    /// `answerLogHasMore = true` when the page is full, and clears any
    /// open detail state. The `entries.count >= limit` heuristic is the
    /// same one the mobile reducer uses for `hasMore` so the operator-
    /// facing pagination behavior stays uniform across surfaces.
    func testLoadAnswerLogReplacesEntriesAndSignalsHasMoreWhenFullPage() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/answers")
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let pairs = Dictionary(
                uniqueKeysWithValues: (comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") }
            )
            XCTAssertEqual(pairs["limit"], "20")
            XCTAssertNil(pairs["beforeId"])

            var entryLines: [String] = []
            for i in 0..<20 {
                entryLines.append(
                    #"{"id": "ans-\#(i)", "createdAt": "2026-04-26T\#(i)", "query": "q\#(i)", "result": {"ok": true, "citationCount": 1}}"#
                )
            }
            let body = "{\"entries\": [\(entryLines.joined(separator: ","))]}"
                .data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let state = makeState()
        // Seed prior open detail to confirm a fresh list-load clears it.
        state.answerShowOpenId = "ans-stale"
        state.answerShowMissing = true
        state.answerShowError = "stale"

        await state.loadAnswerLog()

        XCTAssertEqual(state.answerLogEntries.count, 20)
        XCTAssertEqual(state.answerLogEntries.first?.id, "ans-0")
        XCTAssertEqual(state.answerLogEntries.last?.id, "ans-19")
        XCTAssertTrue(
            state.answerLogHasMore,
            "Full page (entries.count >= limit) must surface as hasMore=true."
        )
        XCTAssertNil(state.answerLogError)
        XCTAssertFalse(state.isLoadingAnswerLog)
        XCTAssertNil(state.answerShowOpenId)
        XCTAssertFalse(state.answerShowMissing)
        XCTAssertNil(state.answerShowError)
    }

    /// A short page (entries < limit) drops `hasMore` to false and
    /// hides the operator-facing "Load older" affordance.
    func testLoadAnswerLogClearsHasMoreOnShortPage() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"""
            {"entries": [
              {"id": "ans-1", "createdAt": "t", "query": "q",
               "result": {"ok": false, "reason": "no_hits"}}
            ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let state = makeState()
        state.answerLogHasMore = true

        await state.loadAnswerLog()

        XCTAssertEqual(state.answerLogEntries.count, 1)
        XCTAssertFalse(
            state.answerLogHasMore,
            "Short page (entries.count < limit) must clear hasMore so the Load older affordance hides."
        )
    }

    /// HTTP failure surfaces in `answerLogError` (the typed banner) and
    /// drops `hasMore` so a stale truth value cannot paint a Load older
    /// affordance over a broken backend.
    func testLoadAnswerLogSurfacesErrorAndClearsHasMore() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"error": "store down"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let state = makeState()
        state.answerLogHasMore = true

        await state.loadAnswerLog()

        XCTAssertNotNil(state.answerLogError)
        XCTAssertFalse(state.answerLogHasMore)
        XCTAssertFalse(state.isLoadingAnswerLog)
    }

    // MARK: - loadMoreAnswerLog

    /// `loadMoreAnswerLog` reads the cursor (`beforeId` = last entry's
    /// id) and appends — the prior list survives, the new page is
    /// concatenated, and the daemon-side pagination contract is honored.
    func testLoadMoreAnswerLogAppendsPageWithBeforeIdCursor() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let pairs = Dictionary(
                uniqueKeysWithValues: (comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") }
            )
            XCTAssertEqual(pairs["beforeId"], "ans-prior-last")
            XCTAssertEqual(pairs["limit"], "20")
            let body = #"""
            {"entries": [
              {"id": "ans-older-1", "createdAt": "t-1", "query": "older 1",
               "result": {"ok": true, "citationCount": 3}},
              {"id": "ans-older-2", "createdAt": "t-2", "query": "older 2",
               "result": {"ok": false, "reason": "no_hits"}}
            ]}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let state = makeState()
        state.answerLogEntries = [
            AnswerHistoryEntry(
                id: "ans-prior-1",
                createdAt: "t0",
                query: "first prior",
                result: .success(citationCount: 1)
            ),
            AnswerHistoryEntry(
                id: "ans-prior-last",
                createdAt: "t-0",
                query: "last prior",
                result: .noHits
            ),
        ]

        await state.loadMoreAnswerLog()

        XCTAssertEqual(state.answerLogEntries.count, 4)
        XCTAssertEqual(state.answerLogEntries.map { $0.id }, [
            "ans-prior-1", "ans-prior-last", "ans-older-1", "ans-older-2",
        ])
    }

    /// `loadMoreAnswerLog` is a no-op when the list is empty — there is
    /// no cursor to send, and a stray request would 400 the daemon.
    func testLoadMoreAnswerLogIsNoOpWhenListEmpty() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        var requestCount = 0
        MockURLProtocol.handler = { request in
            requestCount += 1
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, Data())
        }

        let state = makeState()
        await state.loadMoreAnswerLog()

        XCTAssertEqual(requestCount, 0)
        XCTAssertTrue(state.answerLogEntries.isEmpty)
    }

    // MARK: - openAnswerShow / closeAnswerShow

    /// `openAnswerShow` lands the typed `success` arm in
    /// `answerShowRecord`, pins which row was opened, and clears the
    /// other `notFound` / error arms.
    func testOpenAnswerShowLandsSuccessRecord() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/answers/ans-42")
            let body = #"""
            {"ok": true,
             "record": {
               "id": "ans-42",
               "createdAt": "2026-04-26T12:34:56Z",
               "query": "what is recall?",
               "filter": {},
               "recallHits": [],
               "result": {"ok": false, "reason": "no_hits"}
             }}
            """#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let state = makeState()
        await state.openAnswerShow(id: "ans-42")

        XCTAssertEqual(state.answerShowOpenId, "ans-42")
        XCTAssertEqual(state.answerShowRecord?.id, "ans-42")
        XCTAssertFalse(state.answerShowMissing)
        XCTAssertNil(state.answerShowError)
        XCTAssertFalse(state.isLoadingAnswerShow)
    }

    /// The discriminated `notFound` arm sets `answerShowMissing` so the
    /// view renders the typed banner instead of a misleading "loading…"
    /// state.
    func testOpenAnswerShowSetsMissingOnNotFoundArm() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"ok": false, "reason": "not_found"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let state = makeState()
        await state.openAnswerShow(id: "missing")

        XCTAssertEqual(state.answerShowOpenId, "missing")
        XCTAssertNil(state.answerShowRecord)
        XCTAssertTrue(state.answerShowMissing)
        XCTAssertNil(state.answerShowError)
    }

    /// HTTP / decode failure surfaces in `answerShowError` (the typed
    /// banner with retry) instead of leaving the surface in a stuck
    /// "loading…" state.
    func testOpenAnswerShowSurfacesError() async {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        MockURLProtocol.handler = { request in
            let body = #"{"error": "broken"}"#.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
            )!
            return (response, body)
        }

        let state = makeState()
        await state.openAnswerShow(id: "ans-bad")

        XCTAssertNil(state.answerShowRecord)
        XCTAssertFalse(state.answerShowMissing)
        XCTAssertNotNil(state.answerShowError)
        XCTAssertFalse(state.isLoadingAnswerShow)
    }

    /// `closeAnswerShow` drops the open-detail bookkeeping without
    /// touching the list — the operator gets back to the list view
    /// without a second roundtrip.
    func testCloseAnswerShowClearsDetailWithoutTouchingList() {
        let state = makeState()
        state.answerLogEntries = [
            AnswerHistoryEntry(
                id: "ans-keep",
                createdAt: "t",
                query: "q",
                result: .success(citationCount: 0)
            )
        ]
        state.answerLogHasMore = true
        state.answerShowOpenId = "ans-detail"
        state.answerShowMissing = true
        state.answerShowError = "boom"

        state.closeAnswerShow()

        XCTAssertNil(state.answerShowOpenId)
        XCTAssertNil(state.answerShowRecord)
        XCTAssertFalse(state.answerShowMissing)
        XCTAssertNil(state.answerShowError)
        XCTAssertFalse(state.isLoadingAnswerShow)
        XCTAssertEqual(state.answerLogEntries.count, 1, "list must survive close()")
        XCTAssertTrue(state.answerLogHasMore)
    }
}
