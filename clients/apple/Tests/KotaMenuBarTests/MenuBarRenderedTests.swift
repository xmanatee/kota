import XCTest
@testable import KotaShared

final class MenuBarRenderedTests: XCTestCase {
    @MainActor
    func testMenuBarShellConstructsTheSharedRenderer() {
        _ = MenuBarView()
        _ = SharedOperatorRootView(presentation: .menuBar)
    }
}
