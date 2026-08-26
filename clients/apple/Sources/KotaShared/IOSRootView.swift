#if os(iOS)
import SwiftUI

/// iOS presentation shell for the same daemon-owned inventory rendered by the
/// macOS menu bar. Tabs are created from bundle intents at runtime.
public struct IOSRootView: View {
    public init() {}

    public var body: some View {
        SharedOperatorRootView(presentation: .tabs)
            .accessibilityIdentifier("ios-root-shared-ui")
    }
}
#endif
