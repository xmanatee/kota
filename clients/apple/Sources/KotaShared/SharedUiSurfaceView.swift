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
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Label(surface.intent.rawValue, systemImage: surface.intent.systemImage)
                    Text(surface.extensionId)
                    Text("·")
                    Text(surface.scopeId)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)

                Text(surface.title)
                    .font(.title2.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Text("Rendered natively from \(surface.protocolVersion.rawValue) · \(surface.attachmentPoint.label)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !(surface.conditions ?? []).isEmpty || !(surface.permissions ?? []).isEmpty {
                    SharedUiRequirementsView(
                        conditions: surface.conditions ?? [],
                        permissions: surface.permissions ?? []
                    )
                }
            }

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

private extension UiAttachmentPoint {
    var label: String {
        switch self {
        case .root: return "root"
        case .intent(let intent): return "\(intent.rawValue)"
        case .surface(let surfaceId): return "under \(surfaceId)"
        }
    }
}
