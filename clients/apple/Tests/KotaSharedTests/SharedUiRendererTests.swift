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
            notifications: InertNotificationManager(),
            platform: platform,
            startPollingOnInit: false
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
        let loadedAction = try XCTUnwrap(state.uiSurfaceBundle?.surfaces.flatMap(\.actions).first {
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
            notifications: InertNotificationManager(),
            platform: platform,
            startPollingOnInit: false
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
            notifications: InertNotificationManager(),
            platform: platform,
            startPollingOnInit: false
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
        XCTAssertNil(state.uiSurfaceBundle)

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
    nonisolated(unsafe) static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "SharedUiMock", code: 1))
            return
        }
        let (response, data) = handler(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
