import SwiftUI

struct SharedUiSurfaceView: View {
    let surface: UiSurface
    let onNavigate: (String) -> Void
    let onSessionSelect: (String) -> Void

    var body: some View {
        let referenced = referencedUiActionIds(surface.nodes)
        let embedded = embeddedUiActionIds(surface.nodes)
        let additionalActions = surface.actions.filter { !referenced.contains($0.actionId) }

        VStack(alignment: .leading, spacing: 18) {
            Text(surface.title)
                .font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)

            Divider()

            ForEach(Array(surface.nodes.enumerated()), id: \.offset) { _, node in
                SharedUiNodeView(
                    node: node,
                    hiddenActionIds: embedded,
                    onNavigate: onNavigate,
                    onSessionSelect: onSessionSelect
                )
            }

            if !additionalActions.isEmpty {
                Divider()
                SharedUiNodeSection(title: "Available actions") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(additionalActions, id: \.actionId) { action in
                            SharedUiActionView(action: action)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("ui-surface-\(surface.surfaceId)")
    }
}
