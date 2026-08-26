@testable import KotaShared

func directoryScope(
    scopeId: String,
    scopeRoot: String,
    displayName: String
) -> ConfiguredScope {
    ConfiguredScope(
        scopeId: scopeId,
        displayName: displayName,
        parentScopeId: "global",
        directoryRoot: scopeRoot
    )
}

func scopeRegistry(
    defaultScopeId: String,
    scopes: [ConfiguredScope]
) -> ScopeRegistryProjection {
    ScopeRegistryProjection(
        rootScopeId: "global",
        defaultScopeId: defaultScopeId,
        scopes: [
            ConfiguredScope(
                scopeId: "global",
                displayName: "Global",
                parentScopeId: nil,
                directoryRoot: nil
            ),
        ] + scopes
    )
}
