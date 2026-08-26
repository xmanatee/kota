import XCTest
@testable import KotaShared

@MainActor
final class SharedUiRendererTests: XCTestCase {
    final class RecordingPlatform: PlatformAffordances {
        private(set) var openedURLs: [URL] = []

        func openURL(_ url: URL) -> Bool {
            openedURLs.append(url)
            return true
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

    func testAppStateLoadsBundleExecutesActionAndDelegatesLinks() async throws {
        let bundleData = try Self.bundleData()
        URLProtocol.registerClass(SharedUiMockURLProtocol.self)
        SharedUiMockURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            if request.url?.path == "/ui/surfaces" {
                XCTAssertEqual(
                    URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems,
                    [URLQueryItem(name: "scopeId", value: "scope-main")]
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
            return (response, Data(#"{"ok":true,"message":"Completed."}"#.utf8))
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
        state.reconcileActiveScopeId(with: makeScopeRegistry(
            defaultScopeId: "scope-main",
            directoryScopes: [directoryScope(
                scopeId: "scope-main",
                displayName: "KOTA",
                directoryRoot: "/tmp/kota"
            )]
        ))

        await state.refreshUiSurfaceBundle()
        let action = try XCTUnwrap(state.sharedUi.bundle?.surfaces.flatMap(\.actions).first { $0.isReady })
        let result = await state.executeUiAction(action)
        XCTAssertTrue(result.ok)
        XCTAssertTrue(state.openUiLinkTarget(.externalUrl(url: "https://example.com/operator")))
        XCTAssertEqual(platform.openedURLs.map(\.absoluteString), ["https://example.com/operator"])
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
