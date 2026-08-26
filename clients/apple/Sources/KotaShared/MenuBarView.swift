import SwiftUI

/// macOS presentation shell for the daemon-owned shared operator inventory.
/// All capability semantics live in `ui.surface.v1`; the menu bar contributes
/// only its compact frame.
public struct MenuBarView: View {
    @EnvironmentObject private var appState: AppState

    public init() {}

    public var body: some View {
        SharedOperatorRootView(presentation: .menuBar)
            .frame(width: 380, height: 620)
            .onAppear { appState.isPopoverOpen = true }
            .onDisappear { appState.isPopoverOpen = false }
    }
}
