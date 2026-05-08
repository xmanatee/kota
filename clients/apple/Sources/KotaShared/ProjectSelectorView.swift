import SwiftUI

/// Header project selector. Hidden when the daemon hosts exactly one
/// project so KOTA-on-itself looks identical to the pre-multi-project
/// experience. Mirrors the web `ProjectSelector` semantics: the selected
/// id drives `appState.activeProjectId`, which threads through every
/// project-scoped daemon route in `fetchAll`. Available on both shells:
/// macOS mounts it inside `MenuBarView`, iOS mounts it inside
/// `IOSRootView`'s Status tab.
public struct ProjectSelectorView: View {
    @EnvironmentObject var appState: AppState

    public init() {}

    public var body: some View {
        if let identity = appState.identity, identity.projects.projects.count > 1,
           let activeId = appState.activeProjectId
        {
            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .imageScale(.small)
                    .foregroundStyle(.secondary)
                Text("Project")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker(
                    "Active project",
                    selection: Binding(
                        get: { activeId },
                        set: { appState.setActiveProjectId($0) }
                    )
                ) {
                    ForEach(identity.projects.projects, id: \.projectId) { entry in
                        Text(entry.displayName).tag(entry.projectId)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.07))
            .accessibilityIdentifier("project-selector")
        }
    }
}
