---
id: task-migrate-the-modulesadmin-kotaclient-namespace-end-
title: Migrate the modulesAdmin KotaClient namespace end-to-end through the daemonClient(link) factory hook (foundation pilot follow-up)
status: done
priority: p1
area: architecture
summary: Move ModulesAdminClient interface, ModuleInspectResult, ModuleInspectEntry, and ModuleReloadResult from src/core/server/kota-client.ts into src/modules/module-manager/client.ts; extend the module-manager daemonClient(link) factory to contribute modulesAdmin (inspect/reload) backed by the typed DaemonTransport; remove modulesInspectHttp, modulesReloadHttp, the temporary inline existence-check GET, and the inline modulesAdmin closure from src/core/server/daemon-client.ts.
created_at: 2026-05-03T10:43:33.538Z
updated_at: 2026-05-03T10:56:13.680Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (commit `927dca24`, 2026-05-03), the audit migration (commit
`b6278cf1`, 2026-05-03), the retract migration (commit `8c212f0c`,
2026-05-03), the answer migration (commit `eb392cd1`, 2026-05-03), the
ownerQuestions migration (commit `68b74850`, 2026-05-03), and the modules
migration (commit `c143c892`, 2026-05-03) have validated the
`daemonClient(link)` foundation pattern by moving seven namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 20 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 1593 lines, `daemon-client.ts` is 2009 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that meaningfully extends the pattern is
`modulesAdmin`:

- 2 methods (`inspect(name)`, `reload(name)`) — the natural follow-up
  to the `modules` migration. Both methods belong to the same module
  (`module-manager`); the prior `modules` task explicitly time-boxed
  its inline existence-check GET inside `modulesReloadHttp` to "exactly
  one migration cycle", and that follow-on cycle is this task. Migrating
  modulesAdmin completes module-manager's pair migration end-to-end and
  removes the only outstanding documented duplication in
  `daemon-client.ts`.
- Already owned by the same `module-manager` module that already exposes
  a `daemonClient(link)` factory (today contributing only `modules`,
  see `index.ts` lines 304-306). The existing factory adds a second
  namespace contribution alongside the first — the same shape every
  prior multi-namespace module owner uses.
- ~65 lines of namespace-owned types in `kota-client.ts`:
  - `ModuleInspectEntry` (lines 1314-1336, ~23 lines): the rich
    per-module inspection summary (name, source, version, description,
    status, dependencies, toolNames, workflowNames, commandNames,
    routeSummaries, channelNames, skillNames, agentNames, optional
    health record, optional commandError/routeError/loadError).
  - `ModuleInspectResult` (lines 1338-1340, 3 lines): the
    discriminated `{ found: true; module } | { found: false }` envelope.
  - `ModuleReloadResult` (lines 1350-1353, 4 lines): the discriminated
    `{ ok: true; reloaded; workflowsActive } | { ok: false; reason: "not_found" } | { ok: false; reason: "daemon_required" }` envelope.
  - `ModulesAdminClient` interface (lines 1367-1370, 4 lines).
  - The interface doc comment block (lines 1342-1366, ~25 lines) moves
    alongside the interface into the module-local `client.ts`.
- ~46 lines of wire code in `daemon-client.ts`:
  - `modulesInspectHttp` (lines 279-293, 15 lines): GET
    `/modules/{encodeURIComponent(name)}` with bearer headers; 404 →
    `{ found: false }`, non-2xx throws with the body's error message,
    success returns the JSON `ModuleInspectResult` verbatim.
  - `modulesReloadHttp` (lines 295-321, 27 lines): chains
    `reloadConfigHttp(transport)` (POST `/reload`) with the inline
    existence-check GET against `/modules` and assembles the
    discriminated `ModuleReloadResult`.
  - The inline `modulesAdmin: { inspect, reload }` closure on the
    central handler builder (lines 1621-1624, 4 lines).
- ~5 lines of inline GET inside `modulesReloadHttp` (lines 307-315) that
  the prior `modules` migration explicitly added as a one-cycle bridge.
  This task removes that inline GET — `modulesAdmin.reload` consumes
  the modules namespace's wire shape through
  `link.requestStrict<ModulesListResult>("GET", "/modules")` (or an
  internal helper that does the same), eliminating the duplicate GET
  and aligning both namespaces of `module-manager` on the strict
  transport pattern.

The migration extends the foundation pattern in two axes the prior
seven pilots did not exercise:

1. **First multi-namespace contribution from a single module's
   `daemonClient(link)` factory.** Every prior pilot migrated exactly
   one namespace per module (doctor: `doctor`; harness-parity:
   `harnessParity`; guardrails-audit: `audit`; retract: `retract`;
   answer: `answer`; owner-questions: `ownerQuestions`; module-manager:
   `modules`). `module-manager` already contributes `modules` through
   its `daemonClient(link)` factory; adding `modulesAdmin` makes it the
   first module to contribute two namespaces from the same factory.
   This validates that the assembly path on `DaemonControlClient` and
   the loader's coverage check correctly handle multi-namespace module
   contributions, and establishes the precedent for the small number
   of remaining multi-namespace module owners (e.g. `cli` if it ever
   contributes more than one namespace).

2. **First migration whose factory body consumes a sibling namespace's
   wire shape.** `modulesAdmin.reload`'s existence check requires the
   `/modules` GET shape — which now lives entirely in `module-manager`.
   The factory either (a) consumes `modules.list` through the same
   `link.requestStrict<T>` call as the modules namespace itself, or
   (b) extracts a tiny private helper inside `module-manager/index.ts`
   that both factories share. Either approach validates the foundation
   pattern's promise that the typed `DaemonTransport` is the only wire
   surface module factories see — neither factory reaches into
   `node:http`, the bearer token, or `.kota/daemon-control.json`, and
   the cross-namespace dependency stays inside the owning module.

`ModuleInspectEntry`, `ModuleInspectResult`, and `ModulesAdminClient`
are also imported by:

- `src/modules/module-manager/admin-operations.ts` (the local-side
  `inspectModule` implementation): imports `ModuleInspectEntry` and
  `ModuleInspectResult` from `#core/server/kota-client.js` today.
- `src/modules/module-manager/index.ts`: imports `ModuleInspectEntry`
  and `ModulesAdminClient` from `#core/server/kota-client.js` today.

Both shifts are in-module imports from `./client.js` after the
migration. Neither file gains a `#modules/*` cross-module import; both
already live inside `module-manager/`.

## Desired Outcome

`modulesAdmin` is the eighth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `ModulesAdminClient`, `ModuleInspectResult`, `ModuleInspectEntry`,
  and `ModuleReloadResult` live in
  `src/modules/module-manager/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `ModulesAdminClient` from the module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/module-manager/index.ts` extends its existing
  `daemonClient(link)` factory to contribute `modulesAdmin` alongside
  the `modules` namespace it already contributes. The factory returns
  `{ modules, modulesAdmin }` backed by `link.requestStrict<T>` calls:
  - `inspect(name)` → `GET /modules/{encodeURIComponent(name)}`. The
    factory does **not** preserve the today's special-cased
    `404 → { found: false }` translation as a divergent code path —
    instead it issues the strict GET and decodes the canonical
    `ModuleInspectResult` discriminated union the daemon already emits.
    Because the daemon route is the source of truth for the
    `{ found: true | false }` envelope, the wire shape is uniform and
    the factory body collapses to one `link.requestStrict<T>` call.
    If the existing daemon route currently emits a 404 status without
    a JSON body for the `not_found` case, the route is amended in this
    task to emit `{ found: false }` with status 200 — matching the rest
    of the migrated namespaces' strict-transport posture and removing
    the `404 → typed result` special-case.
  - `reload(name)` → composes (1) `link.requestStrict<...>("POST", "/reload")`
    for the config reload and (2) `link.requestStrict<ModulesListResult>("GET", "/modules")`
    for the existence check. The factory assembles the discriminated
    `ModuleReloadResult` from those two responses, replacing today's
    `modulesReloadHttp` chain. Strict transport errors propagate through
    `requestStrict<T>` per the established foundation pattern. The
    `daemon_required` variant is unreachable from the daemon-side
    factory by construction (the daemon is already the thing servicing
    the call); the local-side handler in
    `src/modules/module-manager/index.ts` continues to return
    `{ ok: false, reason: "daemon_required" }` exactly as it does
    today.
- `src/core/server/daemon-client.ts` no longer carries
  `modulesInspectHttp`, `modulesReloadHttp`, the temporary inline
  existence-check GET, or the inline `modulesAdmin: { inspect, reload }`
  closure on the core-side stub builder. The
  `ModuleInspectResult` / `ModuleReloadResult` imports from
  `./kota-client.js` are removed.
- `src/modules/module-manager/admin-operations.ts` imports
  `ModuleInspectEntry` and `ModuleInspectResult` from `./client.js`
  instead of `#core/server/kota-client.js`.
- `src/modules/module-manager/index.ts` imports `ModuleInspectEntry`
  and `ModulesAdminClient` from `./client.js` instead of
  `#core/server/kota-client.js`.
- A new daemon-side factory unit test alongside the module
  (extending `src/modules/module-manager/daemon-client.test.ts` with a
  `modulesAdmin` describe block, mirroring the existing `modules`
  describe block) exercises the wire shape against a mock
  `DaemonTransport`. The test pins (1) the factory contributes
  `modulesAdmin`, (2) `inspect` routes through `requestStrict<T>` with
  `GET /modules/{encodeURIComponent(name)}` and no body, (3) a
  successful `{ found: true; module }` response decodes verbatim,
  (4) a `{ found: false }` response decodes verbatim, (5) `reload`
  routes through `requestStrict<T>` with `POST /reload` and
  `GET /modules` in sequence, (6) the `not_found` variant assembles
  when the existence check excludes the requested name, (7) the
  `ok: true` variant assembles when both calls succeed and the name
  is present, (8) `requestStrict<T>` failures on either underlying
  call propagate through `inspect` / `reload` rather than being
  silently swallowed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"modulesAdmin"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `modulesAdmin` handler returning `{ found: false }` for
  `inspect` and `{ ok: false, reason: "not_found" }` for `reload` so
  tests that build a `DaemonControlClient` purely to exercise
  non-namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — `/modules/{name}` GET keeps its response shape
  (`ModuleInspectResult`) and `/reload` POST keeps its response shape
  (`{ ok; workflows; changedModules }`) exactly as the
  `daemon-control-server.ts` route handlers emit them. The one
  acceptable shape adjustment is converting `/modules/{name}`'s
  current `404` not-found branch to a `200 { found: false }` to align
  with the strict-transport posture every other migrated namespace
  uses; if the route already returns `200 { found: false }`, no shape
  change is needed and this clause is a no-op.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`.
- Strict error handling. Today's `modulesInspectHttp` and
  `modulesReloadHttp` already throw on non-2xx; the migration
  preserves that posture through `requestStrict<T>`. The temporary
  `.catch(() => null)` swallow on the inline existence-check GET
  inside `modulesReloadHttp` is removed — the strict GET path
  propagates transport failures the same way `modules.list` does.
- No legacy or compatibility surface. Delete `modulesInspectHttp`,
  `modulesReloadHttp`, the inline closure, the temporary inline
  existence-check GET, the central type declarations, and the
  `ModuleInspectResult` / `ModuleReloadResult` imports at the
  migration's edges as it completes; do not leave shims. The
  in-module import shifts from `#core/server/kota-client.js` to
  `./client.js` are hard cutovers, not parallel re-exports.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `ModuleInspectEntry` / `ModuleInspectResult` /
  `ModuleReloadResult` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, audit, retract, answer,
  ownerQuestions, and modules migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota module inspect <name>`,
  `kota module reload <name>`), daemon-up vs daemon-down branching,
  and `--json` output all continue to behave identically modulo the
  optional 404→200 alignment above (which the CLI propagates through
  the same discriminated `{ found: false }` branch either way).
- Output continues to flow through `src/modules/rendering`. The
  module-manager module's existing CLI rendering is not part of this
  refactor.

## Done When

- `src/modules/module-manager/client.ts` declares
  `ModulesAdminClient`, `ModuleInspectResult`, `ModuleInspectEntry`,
  and `ModuleReloadResult` alongside the existing `ModulesClient`
  declarations. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `ModulesAdminClient` from
  this module.
- `src/modules/module-manager/index.ts` extends its existing
  `daemonClient(link)` factory to contribute `modulesAdmin` alongside
  the `modules` namespace, returning
  `{ modules, modulesAdmin }`. Both namespaces' factory bodies use
  the typed `DaemonTransport`; neither reaches into `node:http`, the
  bearer token, or `.kota/daemon-control.json`.
- `src/modules/module-manager/index.ts` and
  `src/modules/module-manager/admin-operations.ts` import
  `ModuleInspectEntry`, `ModuleInspectResult`, and
  `ModulesAdminClient` from `./client.js` (not from
  `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  modulesAdmin-specific code: no `modulesInspectHttp`, no
  `modulesReloadHttp`, no inline `modulesAdmin: { inspect, reload }`
  closure on the core-side stub builder, no temporary inline
  existence-check GET inside any helper, and no
  `ModuleInspectResult` / `ModuleReloadResult` imports from
  `./kota-client.js`.
- `src/modules/module-manager/daemon-client.test.ts` extends with a
  `modulesAdmin` describe block covering both methods (wire shape,
  successful and not-found decoding, transport-error propagation,
  coverage success when the contribution is supplied, and coverage
  failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"modulesAdmin"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `modulesAdmin` handler.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `ModuleInspectEntry` / `ModuleInspectResult` / `ModuleReloadResult`
  declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`modulesAdmin-daemon-up.txt` / `modulesAdmin-daemon-down.txt`)
  demonstrate parity for `kota module inspect <name>` and
  `kota module reload <name>` showing the pre/post output is
  identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T10-41-26-447Z-explorer-dgidaw/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Nine orthogonal preludes have already landed:

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all
  chunking answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and
  the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook.
- `927dca24` — harnessParity migration extending the pattern to a
  two-method namespace.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace.
- `8c212f0c` — retract migration extending the pattern to a JSON-body
  POST with discriminated request/result unions.
- `eb392cd1` — answer migration extending the pattern to a
  multi-verb namespace mixing POST + GET + GET-with-path-id.
- `68b74850` — ownerQuestions migration extending the pattern to two
  POSTs sharing an id-bearing path stem.
- `c143c892` — modules migration extending the pattern to the
  smallest single-method namespace, validating the
  `daemonClient(link)` factory pattern collapses cleanly to a single
  `link.requestStrict<T>` call.

`modulesAdmin` is the natural next pilot for two reasons. First, it
removes the only documented temporary duplication left in
`daemon-client.ts` — the inline existence-check GET inside
`modulesReloadHttp` that the prior `modules` task explicitly
time-boxed to "exactly one migration cycle". Second, it makes
`module-manager` the first module to contribute two namespaces from
the same `daemonClient(link)` factory, validating the assembly path
and coverage check for multi-namespace module contributions and
establishing the precedent for any future multi-namespace owners.
The migration is needed under every chunking answer the owner can
pick (a/b/c/d/unblock): the modulesAdmin namespace migrates exactly
once regardless of whether the parent lands in one cohesive run or
fans out across follow-ups, so this task does not commit the owner
to any specific chunking answer; it shrinks the parent task's scope
by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the
owning module, with `src/core/` reduced to genuine cross-cutting
protocols and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type moves out of `src/core/server/`, the
  extended `daemonClient` factory on `moduleManagerModule`, the
  in-module import shifts in `index.ts` and `admin-operations.ts`,
  the removed `modulesInspectHttp` / `modulesReloadHttp` / inline
  existence-check GET / inline closure, and the extended daemon-side
  unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~65-line and ~46-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`modulesAdmin-daemon-up.txt` / `modulesAdmin-daemon-down.txt`)
  exercising `kota module inspect <name>` and `kota module reload
  <name>` with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `ModuleInspectEntry`
  / `ModuleInspectResult` / `ModuleReloadResult` declaration in
  `src/core/server/`.
