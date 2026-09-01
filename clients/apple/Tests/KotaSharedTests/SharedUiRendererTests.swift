import XCTest
@testable import KotaShared

@MainActor
final class SharedUiRendererTests: XCTestCase {
    final class RecordingPlatform: PlatformAffordances {
        private(set) var openedURLs: [URL] = []
        var opensURLs = true

        func openURL(_ url: URL) -> Bool {
            openedURLs.append(url)
            return opensURLs
        }

        func pickScopeDirectory() async -> URL? {
            URL(fileURLWithPath: "/tmp/kota-shared-ui")
        }

        func openAppSettings() {}
        var supportsQuit: Bool { false }
        var supportsNativeScopePicker: Bool { true }
        func quitApp() {}
    }

    override func tearDown() {
        URLProtocol.unregisterClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = nil
        super.tearDown()
    }

    func testInventoryUsesOnlyDaemonSurfaceOrderAndIntent() throws {
        let bundle = try Self.bundle()
        let inventory = SharedUiInventory(bundle: bundle)

        XCTAssertEqual(inventory.surfaces.map(\.surfaceId), bundle.surfaces
            .sorted {
                if $0.order != $1.order { return $0.order < $1.order }
                if $0.intent != $1.intent { return $0.intent.rawValue < $1.intent.rawValue }
                return $0.title.localizedStandardCompare($1.title) == .orderedAscending
            }
            .map(\.surfaceId))
        XCTAssertEqual(
            inventory.intents,
            inventory.surfaces.reduce(into: [UiIntent]()) { intents, surface in
                if !intents.contains(surface.intent) { intents.append(surface.intent) }
            }
        )
    }

    func testInventoryPreservesSurfaceHierarchyAndChoosesRootEntry() throws {
        let template = try XCTUnwrap(Self.bundle().surfaces.first)
        let root = Self.surface(
            from: template,
            id: "root",
            title: "Root",
            order: 20,
            attachment: .root
        )
        let child = Self.surface(
            from: template,
            id: "child",
            title: "Child",
            order: 1,
            attachment: .surface(surfaceId: root.surfaceId)
        )
        let peer = Self.surface(
            from: template,
            id: "peer",
            title: "Peer",
            order: 10,
            attachment: .intent(intent: template.intent)
        )

        let inventory = SharedUiInventory(bundle: UiSurfaceBundle(
            protocolVersion: .uiSurfaceV1,
            surfaces: [child, peer, root]
        ))

        XCTAssertEqual(inventory.entrySurface?.surfaceId, "root")
        let entries = inventory.entries(for: template.intent)
        XCTAssertEqual(entries.map(\.surface.surfaceId), ["peer", "root", "child"])
        XCTAssertEqual(entries.map(\.depth), [0, 0, 1])
    }

    func testSubscriptionIdentityIncludesConnectionAndScope() throws {
        let bundle = try Self.bundle()
        let local = try XCTUnwrap(UiSurfaceEventSubscription(
            bundle: bundle,
            source: DaemonRequestSource(
                connection: DaemonConnection(
                    baseURL: URL(string: "http://127.0.0.1:8001")!,
                    token: "one"
                ),
                scopeId: "scope-main",
                daemonPID: 1,
                daemonStartedAt: "one"
            )
        ))
        let remote = try XCTUnwrap(UiSurfaceEventSubscription(
            bundle: bundle,
            source: DaemonRequestSource(
                connection: DaemonConnection(
                    baseURL: URL(string: "https://daemon.example")!,
                    token: "two"
                ),
                scopeId: "scope-main",
                daemonPID: 2,
                daemonStartedAt: "two"
            )
        ))
        let otherScope = try XCTUnwrap(UiSurfaceEventSubscription(
            bundle: bundle,
            source: DaemonRequestSource(
                connection: local.connection,
                scopeId: "scope-other",
                daemonPID: 1,
                daemonStartedAt: "one"
            )
        ))

        XCTAssertNotEqual(local, remote)
        XCTAssertNotEqual(local, otherScope)
    }

    func testEventMatchingRejectsOtherScopesAndMapsCurrentScopeStreams() throws {
        let template = try XCTUnwrap(Self.bundle().surfaces.first)
        let stream = UiNode.logStream(
            entries: [],
            source: UiLogStreamSource(
                eventTypes: ["workflow.updated"],
                kind: .sse,
                path: "/events"
            ),
            streamId: "workflow-log",
            title: "Workflow log"
        )
        let surface = Self.surface(
            from: template,
            id: "scoped",
            title: "Scoped",
            order: 1,
            attachment: .root,
            nodes: [stream],
            refreshEvents: ["workflow.updated"]
        )
        let bundle = UiSurfaceBundle(protocolVersion: .uiSurfaceV1, surfaces: [surface])

        let otherScope = matchUiSurfaceEvent(
            bundle: bundle,
            event: UiSurfaceLiveEvent(
                id: "event-1",
                type: "workflow.updated",
                scopeId: "scope-other",
                timestamp: "2026-08-26T00:00:00Z",
                level: .info,
                message: "other"
            )
        )
        let currentScope = matchUiSurfaceEvent(
            bundle: bundle,
            event: UiSurfaceLiveEvent(
                id: "event-2",
                type: "workflow.updated",
                scopeId: surface.scopeId,
                timestamp: "2026-08-26T00:00:01Z",
                level: .warn,
                message: "current"
            )
        )

        XCTAssertEqual(otherScope, UiSurfaceEventMatch(refresh: false, streamIds: []))
        XCTAssertEqual(currentScope, UiSurfaceEventMatch(refresh: true, streamIds: ["workflow-log"]))
    }

    func testEventWatchReplaysAfterCursorAndPreservesEnvelopeIdentity() async throws {
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Last-Event-ID"), "event-41")
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "text/event-stream"]
            )!
            let body = """
            id: event-42
            event: workflow.updated
            data: {"scopeId":"scope-main","timestamp":"2026-08-26T00:00:00Z","level":"warn","message":"Updated"}


            """
            return (response, Data(body.utf8))
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "token")
        var events: [UiSurfaceLiveEvent] = []

        try await client.watchUiSurfaceEvents(
            eventTypes: ["workflow.updated"],
            afterEventId: "event-41"
        ) { event in
            events.append(event)
        }

        XCTAssertEqual(events, [UiSurfaceLiveEvent(
            id: "event-42",
            type: "workflow.updated",
            scopeId: "scope-main",
            timestamp: "2026-08-26T00:00:00Z",
            level: .warn,
            message: "Updated"
        )])
    }

    func testAppStateLoadsBundleExecutesActionAndDelegatesLinks() async throws {
        let bundle = try Self.bundle()
        let bundleData = try Self.bundleData()
        let action = try XCTUnwrap(bundle.surfaces.flatMap(\.actions).first { $0.isReady })
        let scopeId = action.scopeId
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            if request.url?.path == "/ui/surfaces" {
                XCTAssertEqual(
                    URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems,
                    [URLQueryItem(name: "scopeId", value: scopeId)]
                )
                return (response, bundleData)
            }

            XCTAssertEqual(request.url?.path, "/ui/actions/execute")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.bodyData.flatMap {
                try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
            }
            XCTAssertNotNil(body?["scopeId"] as? String)
            XCTAssertNotNil(body?["surfaceId"] as? String)
            XCTAssertNotNil(body?["actionId"] as? String)
            return (response, Data(#"{"ok":true,"message":"Completed.","payload":{"kind":"external-url","url":"https://example.com/setup","label":"Open setup"}}"#.utf8))
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")
        let platform = RecordingPlatform()
        let state = AppState(
            client: client,
            platform: platform
        )
        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: scopeId,
            scopes: [directoryScope(
                scopeId: scopeId,
                scopeRoot: "/tmp/kota",
                displayName: "KOTA"
            )]
        ))

        await state.refreshUiSurfaceBundle()
        guard case .loaded = state.uiSurfaces.state else {
            return XCTFail("Expected a loaded shared UI resource")
        }
        let loadedAction = try XCTUnwrap(state.uiSurfaces.value?.surfaces.flatMap(\.actions).first {
            $0.actionId == action.actionId
        })
        let result = await state.executeUiAction(loadedAction)
        XCTAssertTrue(result.ok)
        XCTAssertNil(result.payload)
        XCTAssertTrue(state.openUiLinkTarget(.externalUrl(url: "https://example.com/operator")))
        XCTAssertEqual(platform.openedURLs.map(\.absoluteString), [
            "https://example.com/setup",
            "https://example.com/operator",
        ])
    }

    func testFailedExternalURLLaunchPreservesTheTransientFallback() async throws {
        let bundle = try Self.bundle()
        let bundleData = try Self.bundleData()
        let action = try XCTUnwrap(bundle.surfaces.flatMap(\.actions).first { $0.isReady })
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            if request.url?.path == "/ui/surfaces" { return (response, bundleData) }
            return (response, Data(#"{"ok":true,"message":"Completed.","payload":{"kind":"external-url","url":"https://example.com/setup","label":"Open setup"}}"#.utf8))
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "test-token")
        let platform = RecordingPlatform()
        platform.opensURLs = false
        let state = AppState(
            client: client,
            platform: platform
        )
        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: action.scopeId,
            scopes: [directoryScope(
                scopeId: action.scopeId,
                scopeRoot: "/tmp/kota",
                displayName: "KOTA"
            )]
        ))

        await state.refreshUiSurfaceBundle()
        let result = await state.executeUiAction(action)

        XCTAssertTrue(result.ok)
        XCTAssertEqual(
            result.payload,
            .externalURL(url: "https://example.com/setup", label: "Open setup")
        )
        XCTAssertEqual(platform.openedURLs.map(\.absoluteString), ["https://example.com/setup"])
    }

    func testSourceChangeRejectsDelayedSurfaceAndActionResponses() async throws {
        let bundle = try Self.bundle()
        let bundleData = try Self.bundleData()
        let action = try XCTUnwrap(bundle.surfaces.flatMap(\.actions).first { $0.isReady })
        let originalScope = action.scopeId
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            Thread.sleep(forTimeInterval: 0.08)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            if request.url?.path == "/ui/surfaces" {
                return (response, bundleData)
            }
            return (response, Data(#"{"ok":true,"message":"Started.","payload":{"kind":"external-url","url":"https://example.com/setup","label":"Open setup"}}"#.utf8))
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "token")
        let platform = RecordingPlatform()
        let state = AppState(
            client: client,
            platform: platform
        )
        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: originalScope,
            scopes: [directoryScope(
                scopeId: originalScope,
                scopeRoot: "/tmp/original",
                displayName: "Original"
            )]
        ))

        let surfaceRefresh = Task { await state.refreshUiSurfaceBundle() }
        try await Task.sleep(nanoseconds: 20_000_000)
        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: "scope-other",
            scopes: [directoryScope(
                scopeId: "scope-other",
                scopeRoot: "/tmp/other",
                displayName: "Other"
            )]
        ))
        await surfaceRefresh.value
        XCTAssertNil(state.uiSurfaces.value)
        guard case .idle = state.uiSurfaces.state else {
            return XCTFail("A source change should cancel and clear the prior resource")
        }

        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: originalScope,
            scopes: [directoryScope(
                scopeId: originalScope,
                scopeRoot: "/tmp/original",
                displayName: "Original"
            )]
        ))
        let actionTask = Task { await state.executeUiAction(action) }
        try await Task.sleep(nanoseconds: 20_000_000)
        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: "scope-other",
            scopes: [directoryScope(
                scopeId: "scope-other",
                scopeRoot: "/tmp/other",
                displayName: "Other"
            )]
        ))
        let result = await actionTask.value
        XCTAssertFalse(result.ok)
        XCTAssertEqual(result.reason, "source-changed")
        XCTAssertTrue(platform.openedURLs.isEmpty)
    }

    func testAppStateClassifiesEmptyAndUnavailableSurfaceResponses() async throws {
        let bundle = try Self.bundle()
        let bundleData = try Self.bundleData()
        let scopeId = try XCTUnwrap(bundle.surfaces.first?.scopeId)
        let emptyData = try JSONEncoder().encode(UiSurfaceBundle(
            protocolVersion: .uiSurfaceV1,
            surfaces: []
        ))
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, emptyData)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "token")
        let state = AppState(client: client)
        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: scopeId,
            scopes: [directoryScope(
                scopeId: scopeId,
                scopeRoot: "/tmp/kota",
                displayName: "KOTA"
            )]
        ))

        await state.refreshUiSurfaceBundle()
        guard case .empty = state.uiSurfaces.state else {
            return XCTFail("Expected an empty shared UI resource")
        }

        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil
            )!
            return (response, Data(#"{"error":"UI module unavailable"}"#.utf8))
        }
        await state.refreshUiSurfaceBundle()
        guard case .unavailable(let issue) = state.uiSurfaces.state else {
            return XCTFail("Expected an unavailable shared UI resource")
        }
        XCTAssertEqual(issue.title, "Shared UI unavailable")
        XCTAssertTrue(issue.detail.contains("UI module unavailable"))

        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, bundleData)
        }
        await state.refreshUiSurfaceBundle()
        guard case .loaded = state.uiSurfaces.state else {
            return XCTFail("Retry should replace unavailability with loaded content")
        }
    }

    func testDaemonSourceChangeDoesNotRetainThePreviousSurfaceOnFailure() async throws {
        let bundleData = try Self.bundleData()
        let scopeId = try XCTUnwrap(Self.bundle().surfaces.first?.scopeId)
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            if request.url?.host == "new-daemon.example" {
                let response = HTTPURLResponse(
                    url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil
                )!
                return (response, Data(#"{"error":"new daemon is starting"}"#.utf8))
            }
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, bundleData)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "https://old-daemon.example")!, token: "old")
        let state = AppState(client: client)
        state.reconcileActiveScopeId(with: scopeRegistry(
            defaultScopeId: scopeId,
            scopes: [directoryScope(
                scopeId: scopeId,
                scopeRoot: "/tmp/kota",
                displayName: "KOTA"
            )]
        ))

        await state.refreshUiSurfaceBundle()
        XCTAssertNotNil(state.uiSurfaces.value)

        client.setRemoteConnection(url: URL(string: "https://new-daemon.example")!, token: "new")
        await state.refreshUiSurfaceBundle()

        XCTAssertNil(state.uiSurfaces.value)
        guard case .unavailable(let issue) = state.uiSurfaces.state else {
            return XCTFail("A new daemon failure must not retain the old daemon's resource")
        }
        XCTAssertTrue(issue.detail.contains("new daemon is starting"))
    }

    func testInvalidAndOfflineSourcesDisconnectBeforeResourceRetry() async throws {
        let bundleData = try Self.bundleData()
        let commandsData = Data(#"{"commands":[{"name":"builder","label":"/builder","source":"workflow","module":"autonomy"}]}"#.utf8)
        let requestLock = NSLock()
        var requestCount = 0
        let readRequestCount = {
            requestLock.lock()
            defer { requestLock.unlock() }
            return requestCount
        }
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            requestLock.lock()
            requestCount += 1
            requestLock.unlock()
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            switch request.url?.path {
            case "/ui/surfaces": return (response, bundleData)
            case "/commands": return (response, commandsData)
            default:
                throw NSError(
                    domain: "SharedUiRendererTests.UnexpectedRetryRoute",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: request.url?.path ?? "nil"]
                )
            }
        }

        let defaults = UserDefaults.standard
        let priorRemoteURL = defaults.object(forKey: "remoteDaemonURL")
        let priorScopeDirectory = defaults.object(forKey: "scopeDirectory")
        defaults.removeObject(forKey: "remoteDaemonURL")
        defaults.removeObject(forKey: "scopeDirectory")
        defer {
            if let priorRemoteURL {
                defaults.set(priorRemoteURL, forKey: "remoteDaemonURL")
            } else {
                defaults.removeObject(forKey: "remoteDaemonURL")
            }
            if let priorScopeDirectory {
                defaults.set(priorScopeDirectory, forKey: "scopeDirectory")
            } else {
                defaults.removeObject(forKey: "scopeDirectory")
            }
        }

        let oldURL = URL(string: "https://old-daemon.example")!
        let client = DaemonClient()
        client.setRemoteConnection(url: oldURL, token: "old")
        let state = AppState(client: client)
        await state.refreshUiSurfaceBundle()
        await state.refreshSlashCommands()
        XCTAssertNotNil(state.uiSurfaces.value)
        XCTAssertNotNil(state.slashCommands.value)

        state.remoteURL = "not a URL"
        await state.refresh()

        XCTAssertNil(client.connection)
        XCTAssertNil(state.uiSurfaces.value)
        XCTAssertNil(state.slashCommands.value)
        guard case .failed = state.uiSurfaces.state else {
            return XCTFail("An invalid URL must replace the prior surface resource")
        }
        guard case .failed = state.slashCommands.state else {
            return XCTFail("An invalid URL must replace the prior command resource")
        }
        let requestsBeforeInvalidRetry = readRequestCount()
        await state.refreshUiSurfaceBundle()
        await state.refreshSlashCommands()
        XCTAssertEqual(readRequestCount(), requestsBeforeInvalidRetry)

        client.setRemoteConnection(url: oldURL, token: "old")
        await state.refreshUiSurfaceBundle()
        await state.refreshSlashCommands()
        XCTAssertNotNil(state.uiSurfaces.value)
        XCTAssertNotNil(state.slashCommands.value)

        state.remoteURL = ""
        state.scopeRoot = nil
        await state.refresh()

        XCTAssertNil(client.connection)
        XCTAssertNil(state.uiSurfaces.value)
        XCTAssertNil(state.slashCommands.value)
        guard case .offline = state.uiSurfaces.state else {
            return XCTFail("A missing local source must replace the prior surface resource")
        }
        guard case .offline = state.slashCommands.state else {
            return XCTFail("A missing local source must replace the prior command resource")
        }
        let requestsBeforeOfflineRetry = readRequestCount()
        await state.refreshUiSurfaceBundle()
        await state.refreshSlashCommands()
        XCTAssertEqual(readRequestCount(), requestsBeforeOfflineRetry)
    }

    func testSlashCommandResourceUsesSharedEmptyFailureAndRetryTransitions() async throws {
        let commands = Data(#"{"commands":[{"name":"builder","label":"/builder","description":"Build the next task","source":"workflow","module":"autonomy"}]}"#.utf8)
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, commands)
        }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "token")
        let state = AppState(client: client)

        await state.refreshSlashCommands()
        guard case .loaded(let loaded) = state.slashCommands.state else {
            return XCTFail("Expected loaded slash commands")
        }
        XCTAssertEqual(loaded.map(\.name), ["builder"])

        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, Data(#"{"commands":[]}"#.utf8))
        }
        await state.refreshSlashCommands()
        guard case .empty = state.slashCommands.state else {
            return XCTFail("Expected an empty slash-command resource")
        }

        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil
            )!
            return (response, Data(#"{"error":"commands module unavailable"}"#.utf8))
        }
        await state.refreshSlashCommands()
        guard case .unavailable(let issue) = state.slashCommands.state else {
            return XCTFail("Expected an unavailable slash-command resource")
        }
        XCTAssertEqual(issue.title, "Commands unavailable")

        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, commands)
        }
        await state.refreshSlashCommands()
        guard case .loaded = state.slashCommands.state else {
            return XCTFail("Retry should restore slash commands")
        }
    }

    func testSlashCommandRefreshCancellationRestoresPreviousAndNewestRequestWins() async throws {
        let originalCommands = Data(#"{"commands":[{"name":"original","label":"/original","source":"workflow","module":"autonomy"}]}"#.utf8)
        let canceledCommands = Data(#"{"commands":[{"name":"canceled","label":"/canceled","source":"workflow","module":"autonomy"}]}"#.utf8)
        let staleCommands = Data(#"{"commands":[{"name":"stale","label":"/stale","source":"workflow","module":"autonomy"}]}"#.utf8)
        let newestCommands = Data(#"{"commands":[{"name":"newest","label":"/newest","source":"workflow","module":"autonomy"}]}"#.utf8)
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        let response: (URLRequest, Data) -> (HTTPURLResponse, Data) = { request, data in
            let http = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (http, data)
        }
        SharedUiMockURLProtocol.handler = { request in response(request, originalCommands) }

        let client = DaemonClient()
        client.setRemoteConnection(url: URL(string: "http://127.0.0.1:8765")!, token: "token")
        let state = AppState(client: client)
        await state.refreshSlashCommands()

        let canceledRequestStarted = expectation(description: "canceled request started")
        SharedUiMockURLProtocol.handler = { request in
            canceledRequestStarted.fulfill()
            Thread.sleep(forTimeInterval: 0.08)
            return response(request, canceledCommands)
        }
        let canceledRefresh = Task { await state.refreshSlashCommands() }
        await fulfillment(of: [canceledRequestStarted], timeout: 1)
        canceledRefresh.cancel()
        await canceledRefresh.value
        guard case .loaded(let afterCancellation) = state.slashCommands.state else {
            return XCTFail("Cancellation should restore the previously loaded commands")
        }
        XCTAssertEqual(afterCancellation.map(\.name), ["original"])

        let requestLock = NSLock()
        var requestCount = 0
        let staleRequestStarted = expectation(description: "stale request started")
        SharedUiMockURLProtocol.handler = { request in
            requestLock.lock()
            requestCount += 1
            let currentRequest = requestCount
            requestLock.unlock()
            if currentRequest == 1 {
                staleRequestStarted.fulfill()
                Thread.sleep(forTimeInterval: 0.08)
                return response(request, staleCommands)
            }
            return response(request, newestCommands)
        }
        let staleRefresh = Task { await state.refreshSlashCommands() }
        await fulfillment(of: [staleRequestStarted], timeout: 1)
        let newestRefresh = Task { await state.refreshSlashCommands() }
        await newestRefresh.value
        await staleRefresh.value

        guard case .loaded(let latest) = state.slashCommands.state else {
            return XCTFail("The newest same-source request should own slash-command state")
        }
        XCTAssertEqual(latest.map(\.name), ["newest"])
    }

    func testDaemonPollingRefreshesSlashCommandsAcrossTransportLossAndReplacement() async throws {
        let bundleData = try Self.bundleData()
        let scopeId = try XCTUnwrap(Self.bundle().surfaces.first?.scopeId)
        let originalIdentity = try Self.identityData(
            scopeId: scopeId,
            pid: 101,
            startedAt: "2026-09-01T10:00:00Z"
        )
        let replacementIdentity = try Self.identityData(
            scopeId: scopeId,
            pid: 202,
            startedAt: "2026-09-01T11:00:00Z"
        )
        let originalCommands = Data(#"{"commands":[{"name":"builder","label":"/builder","description":"Build the next task","source":"workflow","module":"autonomy"}]}"#.utf8)
        let replacementCommands = Data(#"{"commands":[{"name":"explorer","label":"/explorer","description":"Explore opportunities","source":"workflow","module":"autonomy"}]}"#.utf8)
        enum DaemonPhase: Equatable { case original, offline, replacement }
        var phase = DaemonPhase.original
        let offlineCommandStarted = expectation(description: "offline command refresh started")
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            if phase == .offline {
                if request.url?.path == "/commands" {
                    offlineCommandStarted.fulfill()
                    Thread.sleep(forTimeInterval: 0.08)
                    throw URLError(.timedOut)
                }
                if request.url?.path != "/identity" { throw URLError(.timedOut) }
            }
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            switch request.url?.path {
            case "/identity":
                return (response, phase == .replacement ? replacementIdentity : originalIdentity)
            case "/ui/surfaces":
                return (response, bundleData)
            case "/commands":
                return (response, phase == .replacement ? replacementCommands : originalCommands)
            default:
                throw NSError(
                    domain: "SharedUiRendererTests.UnexpectedPollingRoute",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: request.url?.path ?? "nil"]
                )
            }
        }

        let client = DaemonClient()
        let state = AppState(client: client)
        let priorRemoteURL = UserDefaults.standard.object(forKey: "remoteDaemonURL")
        defer {
            if let priorRemoteURL {
                UserDefaults.standard.set(priorRemoteURL, forKey: "remoteDaemonURL")
            } else {
                UserDefaults.standard.removeObject(forKey: "remoteDaemonURL")
            }
        }
        state.remoteURL = "http://127.0.0.1:8765"

        await state.refresh()
        XCTAssertNotNil(state.uiSurfaces.value)
        guard case .loaded(let original) = state.slashCommands.state else {
            return XCTFail("Polling must load slash commands with the other daemon resources")
        }
        XCTAssertEqual(original.map(\.name), ["builder"])

        phase = .offline
        let offlineRefresh = Task { await state.refresh() }
        await fulfillment(of: [offlineCommandStarted], timeout: 1)
        XCTAssertNil(
            state.slashCommands.value,
            "A surface transport failure must clear stale commands before command retry finishes"
        )
        await offlineRefresh.value

        XCTAssertNil(state.uiSurfaces.value)
        XCTAssertNil(state.slashCommands.value)
        guard case .offline(let surfaceIssue) = state.uiSurfaces.state else {
            return XCTFail("Transport loss must render shared UI offline")
        }
        guard case .offline(let commandIssue) = state.slashCommands.state else {
            return XCTFail("Transport loss must render slash commands offline")
        }
        XCTAssertEqual(surfaceIssue.title, "Daemon offline")
        XCTAssertEqual(commandIssue.title, "Daemon offline")

        phase = .replacement
        await state.refresh()

        guard case .loaded(let replacement) = state.slashCommands.state else {
            return XCTFail("A replacement daemon poll must reload slash commands")
        }
        XCTAssertEqual(replacement.map(\.name), ["explorer"])
        XCTAssertEqual(state.identity?.pid, 202)
    }

    private static func bundleData() throws -> Data {
        guard let url = Bundle.module.url(forResource: "ui-behavior-vectors.generated", withExtension: "json"),
              let tree = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
              let bundle = tree["operatorBundle"]
        else { throw NSError(domain: "fixture", code: 1) }
        return try JSONSerialization.data(withJSONObject: bundle, options: [.sortedKeys])
    }

    private static func bundle() throws -> UiSurfaceBundle {
        try JSONDecoder().decode(UiSurfaceBundle.self, from: bundleData())
    }

    private static func identityData(
        scopeId: String,
        pid: Double,
        startedAt: String
    ) throws -> Data {
        try JSONEncoder().encode(ClientIdentity(
            scopeName: "KOTA",
            scopeRoot: "/tmp/kota",
            scopeRegistry: scopeRegistry(
                defaultScopeId: scopeId,
                scopes: [directoryScope(
                    scopeId: scopeId,
                    scopeRoot: "/tmp/kota",
                    displayName: "KOTA"
                )]
            ),
            daemonVersion: "1.0.0",
            pid: pid,
            startedAt: startedAt,
            dashboard: .unavailable(reason: "module_disabled", message: nil)
        ))
    }

    private static func surface(
        from template: UiSurface,
        id: String,
        title: String,
        order: Double,
        attachment: UiAttachmentPoint,
        nodes: [UiNode]? = nil,
        refreshEvents: [String]? = nil
    ) -> UiSurface {
        UiSurface(
            actions: template.actions,
            attachmentPoint: attachment,
            conditions: template.conditions,
            extensionId: template.extensionId,
            intent: template.intent,
            nodes: nodes ?? template.nodes,
            order: order,
            permissions: template.permissions,
            protocolVersion: template.protocolVersion,
            refreshEvents: refreshEvents ?? template.refreshEvents,
            scopeId: template.scopeId,
            surfaceId: id,
            title: title
        )
    }
}

private extension URLRequest {
    var bodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: 1024)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private final class SharedUiMockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "SharedUiMock", code: 1))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
