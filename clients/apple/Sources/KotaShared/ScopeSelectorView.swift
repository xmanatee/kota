import SwiftUI

/// Header directory-scope selector. Hidden when the daemon hosts exactly one
/// directory scope. The selected id drives `appState.activeScopeId`, which
/// threads through every scope-aware daemon route in `fetchAll`.
/// macOS mounts it inside `MenuBarView`, iOS mounts it inside
/// `IOSRootView`'s Status tab.
public struct ScopeSelectorView: View {
    @EnvironmentObject var appState: AppState

    public init() {}

    public var body: some View {
        if let identity = appState.identity,
           identity.scopeRegistry.scopes.filter({ $0.directoryRoot != nil }).count > 1,
           let activeId = appState.activeScopeId
        {
            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .imageScale(.small)
                    .foregroundStyle(.secondary)
                Text("Scope")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker(
                    "Active scope",
                    selection: Binding(
                        get: { activeId },
                        set: { appState.setActiveScopeId($0) }
                    )
                ) {
                    ForEach(
                        identity.scopeRegistry.scopes.filter { $0.directoryRoot != nil },
                        id: \.scopeId
                    ) { entry in
                        Text(entry.displayName).tag(entry.scopeId)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.07))
            .accessibilityIdentifier("scope-selector")
        }
    }
}
