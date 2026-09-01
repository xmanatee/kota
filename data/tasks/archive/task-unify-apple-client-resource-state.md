---
status: done
---

# Unify Apple client resource state

## Scope / Starting Points

Inventory `clients/apple/Sources` and `clients/apple/Tests` for repeated loading, result, empty, offline, retry, cancellation, failure, and semantic-unavailable state and screen setup.

## Required Changes

- Introduce one Swift-native typed resource state owner and composable presentation shell.
- Migrate every inventoried Apple resource screen or record a genuine native exception.
- Preserve accessibility, navigation, cancellation, offline, retry, and owner-visible rendering.
- Delete duplicated view models/reducers, lifecycle fixtures, reset hooks, and repeated transition matrices.

## Must Not Complete While

Any screen is unclassified, shared transitions remain copied, or TypeScript abstractions leak across the language boundary.

## Done When

Every Apple resource screen uses the Swift owner or has a documented unique exception and retained checks cover only Apple/domain behavior.

## Acceptance Evidence

Provide the Apple screen/state/disposition matrix and before/after production, test, and support LOC.

### Completion record

| Apple surface | State inventory | Disposition |
| --- | --- | --- |
| macOS menu bar and iOS tabs via `SharedOperatorRootView` | Initial load, refresh with prior value, loaded, empty, offline, semantic unavailable, recoverable failure, retry, request cancellation, scope/source replacement | `ResourceStateOwner<UiSurfaceBundle>` owns transitions and `ResourceStateShell` owns common rendering. `AppState` retains transport tokens and live-event reconciliation. |
| `ChatView` slash-command palette | Initial load, refresh with prior commands, loaded, empty, offline, semantic unavailable, recoverable failure, retry, cancellation, daemon/scope replacement | `ResourceStateOwner<[SlashCommand]>` in `AppState` and `ResourceStateShell` in the palette; failure no longer silently becomes an empty catalog. |
| Scope selector, connection bar, and daemon diagnostic | Identity/bootstrap, selected scope, event connection | Connection-projection exception owned by `AppState` and `DaemonConnectionDiagnostic`; these controls do not independently fetch a replaceable resource. |
| Shared UI protocol nodes and live logs | Daemon-authored empty/error nodes, action readiness, bounded event entries | Protocol/stream exception inside a loaded `ui.surface.v1` bundle; generated wire types and bundle-source resets remain authoritative. |
| Chat transcript and session stream | Incremental messages, streaming failure, session end | Interaction exception; append-only stream state is not a replaceable resource. |
| Shared UI forms and actions | Local field editing, validation, confirmation, mutation result | Form/mutation exception with domain-local ownership. |
| Voice capture, transcription, synthesis, and playback | Recording, upload, speaking, hardware/provider failure | Native hardware interaction exception owned by `VoiceState` and `VoiceController`. |
| Settings | Editable local/remote connection drafts, Keychain token, directory selection | Local configuration exception; values are operator drafts, not fetched resources. |

Physical line counts compare admitted `HEAD` with the completed workspace:

| Category | Before | After | Definition |
| --- | ---: | ---: | --- |
| Production | 4,260 | 4,595 | Apple `Sources/**/*.swift`, excluding generated bindings |
| Tests | 989 | 1,433 | Apple `Tests/**/*.swift` |
| Support | 4,092 | 4,092 | Generated Swift/JSON bindings and fixtures, `Package.swift`, and Apple build scripts |

The shared owner replaces separate bundle/loading/error fields and copied presentation branches. The source boundary now clears both resource values before any replacement-daemon request, and invalid or unavailable discovery clears the transport connection so retry cannot reconstruct authority from the previous daemon. URLSession connectivity loss clears loaded values into the offline state instead of retaining stale actions. Slash-command refreshes also have request-local identity and cancellation ownership: caller cancellation restores the prior catalog, a superseded same-source response cannot overwrite its successor, and the daemon polling path refreshes commands after transport recovery or daemon replacement. Native rendering evidence and the full inventory live in the builder run artifact `apple-resource-state-evidence.md`; production and shared-test sources typecheck with the Apple compiler, and compiled URLSession probes verify transport-loss, source-reset retry isolation, daemon-replacement, and slash-command cancellation/race behavior. SwiftPM execution was blocked during build planning by the managed sandbox's inaccessible Xcode/SwiftPM paths, before any package test could execute.

## Initiative

Child of `task-unify-client-resource-state-and-search-shells`.
