---
id: task-migrate-the-modules-kotaclient-namespace-end-to-en
title: Migrate the modules KotaClient namespace end-to-end through the daemonClient(link) factory hook (foundation pilot follow-up)
status: ready
priority: p1
area: architecture
summary: Move ModulesClient interface, ModulesListResult, and ModuleListEntry from src/core/server/kota-client.ts into src/modules/module-manager/client.ts; add a daemonClient(link) factory on the module-manager module that wires list (GET /modules) through the typed DaemonTransport; remove listModulesHttp and the inline modules handler closure from src/core/server/daemon-client.ts; inline the existence-check GET in modulesReloadHttp so modulesAdmin remains unmigrated and untouched.
created_at: 2026-05-03T10:08:34.834Z
updated_at: 2026-05-03T10:08:34.834Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (commit `927dca24`, 2026-05-03), the audit migration
(commit `b6278cf1`, 2026-05-03), the retract migration (commit
`8c212f0c`, 2026-05-03), the answer migration (commit `eb392cd1`,
2026-05-03), and the ownerQuestions migration (commit `68b74850`,
2026-05-03) have validated the `daemonClient(link)` foundation pattern
by moving six namespaces out of `src/core/server/kota-client.ts` and
`src/core/server/daemon-client.ts` into their owning modules. 21
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 1632 lines,
`daemon-client.ts` is 2020 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that meaningfully extends the pattern is
`modules`:

- 1 method (`list()`) — the smallest namespace surface remaining and
  the first single-method namespace migration. The doctor pilot was
  two methods (`run`, `fix`); harnessParity was two
  (`list`, `run`); audit, retract, answer, and ownerQuestions were
  multi-method. None of the prior six pilots validated the pattern
  for a one-method namespace, where the `daemonClient(link)` factory
  collapses to a single `link.requestStrict<T>` call without any
  helper indirection.
- Already owned by a dedicated module under
  `src/modules/module-manager/` with its own `localClient(ctx)`
  factory (in `index.ts`, lines 286-301), HTTP routes
  (`moduleManagerRoutes`, registered against the regular HTTP
  server), and control routes (registered through
  `daemon-control-server.ts`'s built-in `/modules` GET handler — not
  a module-contributed control route).
- ~20 lines of namespace-owned types in `kota-client.ts`:
  - `ModuleListEntry` (lines 973-986, 14 lines): the per-module
    summary surfaced to the navigator (`name`, `source`, `status`,
    optional `version`/`description`, contribution counts, optional
    `loadError`).
  - `ModulesListResult` (lines 988-990, 3 lines): the wrapping
    result envelope.
  - `ModulesClient` interface (lines 1020-1022, 3 lines): one
    method, `list(): Promise<ModulesListResult>`.
- ~22 lines of wire code in `daemon-client.ts`:
  - `listModulesHttp` (lines 632-644, 13 lines): GET `/modules` with
    bearer headers; converts HTTP errors and network failures into
    `null` (the silent-failure antipattern the foundation pattern
    explicitly rejects). The transformation back to a thrown error
    happens in the inline closure below.
  - The inline `modules: { list: ... }` closure on the central
    handler builder (lines 1595-1601, 7 lines) that converts
    `listModulesHttp`'s `null` fallback into an explicit
    `Daemon unreachable while listing modules` thrown error.
  - The `ModuleListEntry` import from `./kota-client.js` (line 59).
- The wire code is the simplest of every remaining namespace: one
  GET, no query parameters, no path segments, no JSON body, no
  discriminated union to decode. The factory body collapses into
  exactly one `link.requestStrict<ModulesListResult>("GET", "/modules")`
  call once the type moves alongside the rest of the namespace.

The migration extends the foundation pattern in one axis the prior
six pilots did not exercise:

1. **First single-method namespace migration.** The `doctor`,
   `harnessParity`, `audit`, `retract`, `answer`, and `ownerQuestions`
   migrations all had at least two methods on their namespace
   (doctor: `run` + `fix`; harnessParity: `list` + `run`; audit:
   `tail` + others; retract: `retract` + `cancel`; answer: `answer`
   + `list` + `show`; ownerQuestions: `list` + `answer` + `dismiss`).
   `modules.list` is the first single-method namespace — proving the
   `daemonClient(link)` factory pattern composes cleanly when a
   namespace exposes exactly one method and the factory body is a
   single `link.requestStrict<T>` call. This validates the pattern
   for the smallest possible surface and establishes the precedent
   for future single-method namespace migrations
   (e.g. `web.start`, `mcpServer.start`).

The interaction with `modulesAdmin` is the one wrinkle this
migration must handle cleanly:

- Today's `modulesReloadHttp` (lines 296-311 of `daemon-client.ts`)
  calls `listModulesHttp` directly to perform an existence check on
  the named module before returning the reload result. After this
  migration, `listModulesHttp` is gone — the `modules.list` wire
  call lives in `module-manager`'s `daemonClient(link)` factory.
- `modulesAdmin` is a separate namespace also owned by the
  module-manager module. It is not migrated by this task because
  bundling them would deviate from the established
  one-namespace-at-a-time pattern and would more than double the
  task's surface (modulesAdmin's `inspect` and `reload` together are
  ~30 more lines of wire code plus their own discriminated unions).
- The migration handles the dependency by inlining the existence-
  check GET inside `modulesReloadHttp` itself: instead of calling
  the now-gone `listModulesHttp`, `modulesReloadHttp` issues its own
  one-line `fetchWithTimeout(`${transport.baseUrl}/modules`, ...)`
  GET against the same `/modules` route. This keeps `modulesAdmin`
  and its wire helpers entirely intact and self-contained until the
  follow-on `modulesAdmin` migration removes them. The temporary
  duplication (one inline GET in `modulesReloadHttp`, one
  `link.requestStrict<T>` GET in module-manager's `daemonClient(link)`)
  is removed when `modulesAdmin` itself migrates next and consumes
  `modules.list` through `link.requestStrict<T>` (or an internal
  helper) the same way.

`ModuleListEntry` is also imported by the navigator at
`src/modules/cli/navigator.ts` (and its co-located test). After this
migration the navigator imports it from the new module-local
`./client.ts` (or `#modules/module-manager/client.js`) instead of
`#core/server/kota-client.js`, mirroring how the answer module's
`AnswerClient` migration shifted in-module consumers in the prior
pilot. The cross-module import (`cli` → `module-manager/client`) is
fine: the `cli` module already imports from many module-owned
client files (it's the navigator). No `dependencies` entry is added
because the import is type-only (`import type { ModuleListEntry }`).

## Desired Outcome

`modules` is the seventh namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `ModulesClient`, `ModulesListResult`, and `ModuleListEntry` live
  in `src/modules/module-manager/client.ts`. The aggregate
  `KotaClient` interface in `src/core/server/kota-client.ts` imports
  `ModulesClient` from the module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/module-manager/index.ts` exposes a `daemonClient(link)`
  factory parallel to its existing `localClient(ctx)` factory. The
  factory returns `{ modules: ModulesClient }` backed by exactly one
  `link.requestStrict<T>` call:
  - `list()` → `GET /modules` with no query string, no body, no path
    encoding. The response shape is `{ modules: ModuleListEntry[] }`.
    The factory does **not** silently swallow HTTP errors into a
    `null` fallback the way today's `listModulesHttp` does — strict
    transport errors propagate through `requestStrict<T>` per the
    established foundation pattern. This is the same strict-error
    posture the doctor, harnessParity, audit, retract, answer, and
    ownerQuestions migrations adopted.
- `src/core/server/daemon-client.ts` no longer carries
  `listModulesHttp` or the inline `modules: { list: ... }` closure
  on the core-side stub builder. The `ModuleListEntry` import from
  `./kota-client.js` is removed.
- `src/core/server/daemon-client.ts`'s `modulesReloadHttp` inlines
  its own existence-check GET against `/modules` (using the same
  `fetchWithTimeout` + `transport.authHeaders()` pattern the rest of
  the file uses), rather than calling the now-gone
  `listModulesHttp`. The inline call returns the same
  `{ modules: ModuleListEntry[] }` shape and the existence check
  proceeds identically. `modulesAdmin` itself is untouched — same
  interface, same wire shape, same handler.
- `src/modules/module-manager/index.ts` and `src/modules/cli/navigator.ts`
  (plus its `navigator.test.ts`) import the modules client types from
  `./client.js` / `#modules/module-manager/client.js` instead of
  `#core/server/kota-client.js`. Every other in-module consumer of
  these types follows the same shift.
- A new daemon-side factory unit test alongside the module
  (`src/modules/module-manager/daemon-client.test.ts`) exercises the
  wire shape against a mock `DaemonTransport`, mirroring
  `src/modules/doctor/daemon-client.test.ts`,
  `src/modules/harness-parity/daemon-client.test.ts`,
  `src/modules/guardrails-audit/daemon-client.test.ts`,
  `src/modules/retract/daemon-client.test.ts`,
  `src/modules/answer/daemon-client.test.ts`, and
  `src/modules/owner-questions/daemon-client.test.ts`. The test
  pins (1) the factory exists, (2) `list` routes through
  `requestStrict<T>` with `GET /modules` and no body, (3) a
  successful response decodes verbatim as
  `{ modules: ModuleListEntry[] }`, (4) `requestStrict<T>` failures
  propagate through `list` rather than being silently swallowed,
  (5) the assembly satisfies coverage with the modules contribution,
  and (6) the assembly throws naming "modules" when the
  contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"modules"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `modules` handler returning `{ modules: [] }` for `list` so
  tests that build a `DaemonControlClient` purely to exercise
  non-namespace daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes or
  wire shape — the `/modules` GET route keeps its response shape
  (`{ modules: ModuleListEntry[] }`) exactly as the
  `daemon-control-server.ts` route handler emits it. No
  opportunistic field reshaping, no per-method body normalization.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`.
- Strict error handling. Today's `listModulesHttp` swallows HTTP
  errors and network failures into `null`, which the inline closure
  rethrows as a generic `Daemon unreachable while listing modules`
  error. The new factory does not preserve the silent-`null` path:
  any non-2xx HTTP status and any network failure throws via
  `requestStrict<T>` with the underlying error message preserved.
  The CLI surface is unaffected because the existing
  `Daemon unreachable while listing modules` thrown error is already
  surfaced to the renderer as a thrown error; the new path simply
  reports the underlying transport failure in the message instead of
  the generic "unreachable" wrapper. This is a strict improvement
  that aligns the daemon-up path with the local path.
- No legacy or compatibility surface. Delete `listModulesHttp`, the
  inline closure, the central type declarations, and the
  `ModuleListEntry` import at the migration's edges as it completes;
  do not leave shims. The in-module import shift from
  `#core/server/kota-client.js` to `./client.js` (and from
  `#core/server/kota-client.js` to `#modules/module-manager/client.js`
  in the navigator) is a hard cutover, not a parallel re-export.
- The temporary inline GET inside `modulesReloadHttp` is the only
  acceptable duplication. It exists for exactly one migration cycle
  — the follow-on `modulesAdmin` migration removes it by routing
  `modulesAdmin.reload`'s existence check through
  `link.requestStrict<ModulesListResult>("GET", "/modules")` (or an
  internal helper that does so). Do not extract the inline GET into
  a new shared helper in `daemon-client.ts`; do not add a
  compatibility export; do not preserve `listModulesHttp` under a
  different name. The duplication is small, scoped, named in the
  follow-on task, and time-boxed.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `ModuleListEntry` / `ModulesListResult` declarations
  in `src/core/server/`. Existing assertions for the doctor,
  harnessParity, audit, retract, answer, and ownerQuestions
  migrations stay green.
- The existing `no-module-imports-in-core` guard (under
  `src/core/agent-harness/no-module-imports-in-core.test.ts`)
  already allows `server/kota-client.ts` to import from
  `#modules/*`; no allowlist edit is needed for this migration.
  The sibling assertion that the allowlist itself stays load-
  bearing as namespaces continue to migrate must continue to hold.
- No protocol change. CLI behavior (`kota module list`),
  daemon-up vs daemon-down branching, and `--json` output all
  continue to behave identically modulo the strict-error change
  above (which only affects error paths the CLI already propagates).
- Output continues to flow through `src/modules/rendering`. The
  module-manager module's existing CLI rendering is not part of
  this refactor.

## Done When

- `src/modules/module-manager/client.ts` exists and declares
  `ModulesClient`, `ModulesListResult`, and `ModuleListEntry`. The
  `KotaClient` aggregate in `src/core/server/kota-client.ts` imports
  `ModulesClient` from this module.
- `src/modules/module-manager/index.ts` exposes `daemonClient(link)`
  parallel to `localClient(ctx)`, returning a single namespace
  contribution `{ modules: ModulesClient }` backed by one
  `link.requestStrict<ModulesListResult>("GET", "/modules")` call.
- `src/modules/module-manager/index.ts`, `src/modules/cli/navigator.ts`,
  and `src/modules/cli/navigator.test.ts` import the modules client
  types from the new module-local file (not from
  `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  modules-specific code: no `listModulesHttp`, no inline
  `modules: { list: ... }` closure on the core-side stub builder,
  no `ModuleListEntry` import from `./kota-client.js`, and no other
  modules-specific helpers (other than the documented inline
  existence-check GET inside `modulesReloadHttp`).
- `modulesReloadHttp` continues to resolve module existence through
  an inline GET against `/modules` (using `fetchWithTimeout` and
  `transport.authHeaders()`) rather than the deleted
  `listModulesHttp`. `modulesAdmin.inspect` and `modulesAdmin.reload`
  behave identically before and after — same wire shape, same
  discriminated result, same handler, same tests.
- `src/modules/module-manager/daemon-client.test.ts` exists and
  covers the wire shape (`GET /modules` with no body), successful
  decoding to `{ modules: ModuleListEntry[] }`, transport-error
  propagation, coverage success when the contribution is supplied,
  and coverage failure when it is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"modules"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `modules` handler returning `{ modules: [] }` for `list`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `ModuleListEntry`
  / `ModulesListResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`modules-daemon-up.txt` / `modules-daemon-down.txt`) demonstrate
  parity for `kota module list` showing the pre/post output is
  identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T10-05-31-546Z-explorer-dqea6q/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Eight orthogonal preludes have already landed:

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all
  chunking answers).
- `203c76a6` — `daemonClient(link)` factory hook on `KotaModule`,
  `DaemonClientHandlers` assembly path on `DaemonControlClient`, and
  the per-namespace types guard
  (`kota-client-namespace-types-guard.test.ts`).
- `9f07ee87` — doctor pilot migrating the smallest namespace
  end-to-end through the new hook, validating the pattern.
- `927dca24` — harnessParity migration extending the pattern to a
  two-method namespace, confirming the per-namespace shape
  generalizes.
- `b6278cf1` — audit migration extending the pattern to a
  query-string-bodied namespace, confirming the shape generalizes
  across read-only `GET` namespaces.
- `8c212f0c` — retract migration extending the pattern to a
  JSON-body POST with discriminated request/result unions,
  confirming the shape generalizes across mutating namespaces.
- `eb392cd1` — answer migration extending the pattern to a
  multi-verb namespace mixing POST + GET + GET-with-path-id, with
  namespace-owned strict response decoders.
- `68b74850` — ownerQuestions migration extending the pattern to
  two POSTs sharing an id-bearing path stem, optional body field
  with conditional serialization, and a payload-bearing
  discriminated mutate result.

`modules` is the next-cleanest namespace and the natural next pilot.
It is the smallest unmigrated namespace by every measure (one
method, one GET route, no path encoding, no body, no discriminated
union to decode) and it extends the pattern in one axis the prior
six pilots did not exercise: the first single-method namespace
migration, validating that the `daemonClient(link)` factory pattern
collapses cleanly to a single `link.requestStrict<T>` call when the
namespace exposes exactly one method. This establishes the
precedent for future single-method namespace migrations
(`web.start`, `mcpServer.start`). It is needed under every chunking
answer the owner can pick (a/b/c/d/unblock): the modules namespace
migrates exactly once regardless of whether the parent lands in one
cohesive run or fans out across follow-ups, so this task does not
commit the owner to any specific chunking answer; it shrinks the
parent task's scope by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the
owning module, with `src/core/` reduced to genuine cross-cutting
protocols and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type moves out of `src/core/server/`, the
  new `daemonClient` factory on `moduleManagerModule`, the
  in-module import shift in `index.ts` and the navigator + its
  test, the inlined existence-check GET inside `modulesReloadHttp`,
  and the new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~20-line and ~22-line shrinkage respectively (net of the
  ~5-line inline GET added back to `modulesReloadHttp`).
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`modules-daemon-up.txt` / `modules-daemon-down.txt`) exercising
  `kota module list` with identical output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `ModuleListEntry`
  / `ModulesListResult` declaration in `src/core/server/`.
