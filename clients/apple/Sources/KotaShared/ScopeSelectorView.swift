import SwiftUI

/// Header scope selector. Hidden when the daemon hosts exactly one
/// scope so KOTA-on-itself looks identical to the pre-multi-scope
/// experience. Mirrors the web `ScopeSelector` semantics: the selected
/// id drives `appState.activeScopeId`, which scopes the shared daemon UI.
/// `SharedOperatorRootView` mounts the same selector in both Apple shells.
public struct ScopeSelectorView: View {
    @EnvironmentObject var appState: AppState

    public init() {}

    public var body: some View {
        if let identity = appState.identity, identity.scopeRegistry.scopes.count > 1,
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
                    ForEach(identity.scopeRegistry.scopes, id: \.scopeId) { entry in
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
