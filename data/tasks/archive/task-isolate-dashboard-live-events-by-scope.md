---
status: done
---

# Keep dashboard live events in the selected scope

## Confirmed failure

Reproduced on main `0fa8700c8`, September 11, 2026, with the production
`useDaemonEvents` hook, real QueryClient and ScopeContext provider, the existing
conformance UI bundle, and a controlled EventSource network port:

- Select `scope-a`.
- Deliver `workflow.run.completed` with
  `{scopeId:"scope-b", message:"scope-b-private-sentinel"}`.
- `liveLogEntries["daemon-events"]` contains the scope B sentinel in scope A's
  dashboard. An assertion requiring zero entries fails with one entry.
- The connection URL is `/api/daemon/events`, with no selected scope.

`clients/web/src/hooks/use-daemon-events.ts` uses the selected scope for query
keys but accepts every matching event payload. `api/sse.ts` opens the global
stream; `src/core/server/server-routes.ts` forwards the daemon's global event
stream. The daemon `/events` route also performs no selected-scope filtering.
This demonstrates incorrect cross-scope presentation; it does not establish
an unauthorized user accessing the globally authorized daemon stream.

## Required outcome

Make event selection follow the same authoritative scope identity as the
dashboard's queries. Use the existing event scope contract to distinguish
scope-specific events from intentional daemon-wide events. Place filtering at
the appropriate shared subscription/projection boundary, not in each surface
or log widget. Trace live delivery and replay through the complete caller path.

Switching scopes must retire the previous selection's subscription and replay
state as appropriate. Define intentional daemon-wide visibility explicitly from
the existing event contract; absence of a scope field must not accidentally
turn malformed scoped events into global events. Keep the ordinary global
operator stream available to consumers that actually request it.

## Acceptance

- The reproduced scope B event never appears in scope A's log and does not
  invalidate A's scoped queries. Matching A events still update its UI.
- Switching scopes and reconnecting/replaying retain isolation and single
  delivery. Retired subscription callbacks cannot mutate the current selection.
- Intentional daemon-wide events retain their declared behavior.
- Prove the boundary with the real hook/providers and controlled transport;
  update the existing scoped guidance, which currently promises this isolation.

No new client store, polling loop or duplicated per-surface filter is required.


## Completion evidence

The dashboard selects its query scope on the SSE request through the web proxy
and daemon transport. Live delivery and replay share the daemon projection;
queue notifications preserve their source scope. Browser filtering consumes the
generated daemon-wide event classification and rejects foreign or unattributed
scoped payloads before invalidation or log append. Each connection has guarded
callbacks, each scope selection has a fresh cursor, and log state is scope-bound.
Updated the web client's scoped guidance.

Validated the production hook with ScopeProvider, QueryClient, the conformance
bundle and controlled EventSource: foreign sentinel and malformed attribution
produce no log or invalidation; matching events update; scope switches clear logs
and cursor; retired callbacks have no effect; reconnect preserves selection and
cursor with single delivery; declared daemon-wide events still invalidate.
The web suite passed 41 tests. The real proxy/client/transport passed two network
port cases, and event projection/replay/transport owner tests passed 16 cases.
`pnpm check:fast`, web TypeScript compilation and Vite production build passed.
Vite used the default Browserslist targets explicitly to avoid ancestor config
reads outside the sandbox, and a fresh output directory avoided denied directory
removal. Cached lockfile packages supplied web dependencies.

Socket-based daemon suites could not bind localhost (EPERM). Executed alternate
proof uses the real route, EventRingBuffer and common live/replay writer with
only the response network port controlled. Swift test/build was attempted with
local scratch/cache directories but could not complete in this sandbox; native
runtime validation is unperformed. The mobile typecheck command reported a skip
because its dependencies are absent; it is not counted as passing proof.
Generated binding freshness passed.
