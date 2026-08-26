@testable import KotaShared

func directoryScope(
    scopeId: String,
    displayName: String,
    directoryRoot: String,
    parentScopeId: String = "global"
) -> ConfiguredScopeEntry {
    ConfiguredScopeEntry(
        scopeId: scopeId,
        displayName: displayName,
        parentScopeId: parentScopeId,
        directoryRoot: directoryRoot
    )
}

func makeScopeRegistry(
    defaultScopeId: String,
    directoryScopes: [ConfiguredScopeEntry]
) -> ScopeRegistryProjection {
    ScopeRegistryProjection(
        rootScopeId: "global",
        defaultScopeId: defaultScopeId,
        scopes: [
            ConfiguredScopeEntry(
                scopeId: "global",
                displayName: "Global",
                parentScopeId: nil,
                directoryRoot: nil
            ),
        ] + directoryScopes
    )
}
