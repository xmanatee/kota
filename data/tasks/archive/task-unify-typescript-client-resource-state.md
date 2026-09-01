---
status: done
---

# Unify TypeScript client resource state

## Scope / Starting Points

Inventory `clients/mobile/src`, `clients/web/src`, and shared client code for idle, loading, success, empty, offline, retry, cancellation, recoverable failure, and semantic-unavailable state across knowledge, memory, history, tasks, recall, answer, digest, attention, capture, and retract.

## Required Changes

- Introduce composable typed variants for common async-resource and search transitions.
- Share production state and shells where runtime/tooling permits; keep web/mobile platform adapters explicit.
- Migrate every inventoried screen or record a genuine domain/platform exception.
- Delete per-screen reducers, lifecycle fixtures, repeated state matrices, and test-only reset hooks.

## Must Not Complete While

Any screen is unclassified, common transitions remain reimplemented, or the replacement is a configuration object dominated by unrelated optional flags.

## Done When

All inventoried screens use the shared owner or document a unique exception; their suites cover only domain actions, rendering, navigation, accessibility, and platform semantics.

## Acceptance Evidence

Provide the screen/state/disposition matrix and before/after production, test, and support LOC.

## Completion Evidence

The TypeScript clients have no domain-specific screens for the inventoried
capabilities. Each capability contributes `ui.surface.v1`; web and Android
render the same bundle through `SharedUiSurface`. The bundle lifecycle uses
the shared `ResourceState` variants (`idle`, `loading`, `retrying`,
`refreshing`, `success`, `empty`, `offline`, `recoverable-failure`, `failure`,
`cancelled`, and `semantic-unavailable`). Table queries use the shared
`SearchState` variants (`idle`, `success`, and `empty`); its typed refinements
own query-plus-filter matching and filter-only empty transitions. Domain empty,
unavailable, error, readiness, and result meaning remains in the daemon graph
rather than being reconstructed by either client.

| Domain | Daemon surface / client presentation | State disposition |
| --- | --- | --- |
| knowledge | `knowledge-store`; shared table/form renderer | Migrated to the shared bundle resource owner and shared table search owner. |
| memory | `stores`; shared table renderer | Migrated to the shared bundle resource owner and shared table search owner. |
| history | `history-store`; shared table renderer | Migrated to the shared bundle resource owner and shared table search owner. |
| tasks | `tasks`; shared searchable table and actions | Migrated to the shared bundle resource owner and shared table search owner. |
| recall | `recall`; shared form/result renderer | Migrated to the shared bundle resource owner; query/result semantics remain graph-owned. |
| answer | `answers`; shared form/history-table renderer | Migrated to the shared bundle resource owner and shared table search owner. |
| digest | `daily-digest`; shared detail renderer | Migrated to the shared bundle resource owner; no local search transition exists. |
| attention | `inbox`; shared list/empty renderer, with `/attention` as a graph-declared daemon-route action | Migrated to the shared bundle resource owner. Arbitrary authenticated daemon-route documents are a genuine Android navigation exception; their lifecycle now uses the reusable mobile resource adapter and exposes retry. |
| capture | `capture`; shared form/action renderer | Migrated to the shared bundle resource owner; write result semantics remain graph-owned. |
| retract | `retract`; shared form/confirmed-action renderer | Migrated to the shared bundle resource owner; destructive action semantics remain graph-owned. |

The web adapter translates TanStack Query state after checking connectivity and
classifying cached emptiness, so an initially paused offline query cannot appear
as indefinite loading and an empty refetch retains its explicit empty shell. The
Android provider and reusable request hook own fetch, stale-request rejection,
retry, and failure transitions. One native resource screen exhaustively maps the
shared lifecycle variants, and both bundle and daemon-route requests use one
failure classifier; screens retain only navigation and native presentation.
There is no operator-cancellable outer bundle request in the
inventoried domains, so cancellation is retained as a typed common variant but
has no domain screen producer. Chat streaming and microphone recording were
classified out of scope because they are session/media state machines, not
resource screens for any inventoried domain.

Physical TS/TSX LOC across `clients/shared`, `clients/web/src`, and
`clients/mobile/src` (generated bindings excluded) changed as follows. Tests
are executable `*.test.*` and `__tests__` sources; support is authored test
setup, utilities, and fixtures. Counts compare `HEAD` with this worktree.

| Category | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production | 7,947 | 8,279 | +332 |
| Executable test | 2,237 | 2,315 | +78 |
| Authored support | 273 | 273 | 0 |

The production increase is the common discriminated owner, the explicit web
query adapter, the Android request adapter, and exhaustive shared shells. No
test behavior moved into support code. Metro explicitly watches the shared
TypeScript owner, and shared-source changes trigger both client workflows; the
Android workflow exports a production bundle so CI exercises that boundary.
Verification used web typechecking, Biome, and all 40 web tests; Android
typechecking; an Android production export through Metro; the two-step rendered
Android production journey (including a failed authenticated route followed by
Retry and success); task validation; and whitespace inspection.

## Initiative

Child of `task-unify-client-resource-state-and-search-shells`.
