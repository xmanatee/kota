---
id: task-migrate-the-workflow-kotaclient-namespace-end-to-end
title: Migrate the workflow KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move WorkflowClient and its 14 supporting result/option types (WorkflowRunsListFilter/WorkflowRunsListResult/WorkflowStatusSnapshot/WorkflowPauseResult/WorkflowAbortResult/WorkflowReloadResult/WorkflowEnableResult/WorkflowDisableResult/WorkflowCancelRunResult/WorkflowAbortRunResult/WorkflowDaemonRequiredResult/WorkflowGetRunResult/WorkflowTriggerOptions/WorkflowTriggerResult/WorkflowDefinitionsResult) from src/core/server/kota-client.ts into src/modules/workflow-ops/client.ts; add a daemonClient(link) factory to src/modules/workflow-ops/index.ts that contributes the workflow namespace handler routing GET /workflow/status, GET /workflow/definitions, GET /workflow/runs, GET /workflow/runs/<id>, POST /workflow/pause, POST /workflow/resume, POST /workflow/abort, POST /workflow/reload, POST /workflow/definitions/<name>/enable, POST /workflow/definitions/<name>/disable, POST /workflow/trigger, POST /workflow/runs/<id>/abort, DELETE /workflow/runs/<id> through the typed DaemonTransport, plus the buildTriggerHttpPayload reshape helper; delete the inline workflow closure on buildCoreStubDaemonClientHandlers from src/core/server/daemon-client.ts; extend STUB_OMITTED_NAMESPACES and buildMigratedNamespaceTestStubs() with the workflow stub. Helpers stay in daemon-client.ts because the non-namespace direct DaemonControlClient methods (pause/resume/abort/reload/trigger/etc.) still consume them.
created_at: 2026-05-05T07:32:17.923Z
updated_at: 2026-05-05T07:32:17.923Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03) and twenty-five
follow-on migrations through `tasks` (commit `c7a42aca`, 2026-05-05)
have validated the `daemonClient(link)` foundation pattern by moving
twenty-six namespaces out of `src/core/server/kota-client.ts` and
`src/core/server/daemon-client.ts` into their owning modules. One
namespace remains centralized in those two files (`kota-client.ts` is
351 lines, `daemon-client.ts` is 630 lines, both still over the
300-line guideline): `workflow`.

`workflow` is the largest and most entangled of the migrations, but
its scope is still bounded:

- 13 methods (`listRuns`, `status`, `getRun`, `listDefinitions`,
  `pause`, `resume`, `abort`, `reload`, `triggerByName`, `enable`,
  `disable`, `cancelRun`, `abortRun`) — all owned by the
  `src/modules/workflow-ops/` module, which already exposes a
  `localClient(ctx)` factory at `src/modules/workflow-ops/index.ts:101-245`
  returning a complete `WorkflowClient` backed by the `WorkflowRunStore`,
  signal-file writes, and `getValidatedWorkflowDefinitions`.
- ~150 lines of namespace-owned types in `kota-client.ts` (lines
  64-258 plus the `WorkflowClient` interface itself):
  `WorkflowRunsListFilter`, `WorkflowRunsListResult`,
  `WorkflowStatusSnapshot`, `WorkflowPauseResult`, `WorkflowAbortResult`,
  `WorkflowReloadResult`, `WorkflowEnableResult`, `WorkflowDisableResult`,
  `WorkflowCancelRunResult`, `WorkflowAbortRunResult`,
  `WorkflowDaemonRequiredResult`, `WorkflowGetRunResult`,
  `WorkflowTriggerOptions`, `WorkflowTriggerResult`,
  `WorkflowDefinitionsResult`, plus the `WorkflowClient` interface.
- ~95 lines of inline namespace-handler closure in
  `daemon-client.ts` — the `workflow: { listRuns, status, pause,
  resume, abort, reload, enable, disable, cancelRun, abortRun, getRun,
  listDefinitions, triggerByName }` closure on
  `buildCoreStubDaemonClientHandlers` (lines 258-349, 92 lines), plus
  the `buildTriggerHttpPayload` reshape helper (lines 31-36, 6 lines)
  and the `WorkflowTriggerOptions` type import (line 16).
- The 13 namespace-only HTTP helpers in `daemon-client.ts`
  (`getWorkflowStatusHttp`, `getWorkflowDefinitionsHttp`, `pauseHttp`,
  `resumeHttp`, `abortHttp`, `reloadHttp`, `enableWorkflowHttp`,
  `disableWorkflowHttp`, `triggerWorkflowHttp`, `abortRunHttp`,
  `cancelRunHttp`, `listWorkflowRunsHttp`, `getWorkflowRunHttp`)
  **stay in `daemon-client.ts`** because the non-namespace direct
  methods on `DaemonControlClient` (`pause()`, `resume()`, `abort()`,
  `reload()`, `enableWorkflow()`, `disableWorkflow()`, `trigger()`,
  `abortRun()`, `cancelRun()`, `listWorkflowRuns()`,
  `getWorkflowRun()`, `getWorkflowStatus()`, `getWorkflowDefinitions()`,
  `dryRun()`) on the class still consume them. Those direct methods
  bridge `kota serve` ⇄ daemon and are not part of the `workflow`
  namespace contract — same pattern as `daemonOps` left
  `getDaemonStatusHttp`, `reloadConfigHttp`, and `daemonManagedHttp`
  in `daemon-client.ts` because non-namespace direct methods on the
  class still consume them. The orthogonal
  `task-decouple-non-namespace-daemon-transport-methods-fr` task
  (commit `a0a5e3e2`, 2026-05-03) audited these methods and left them
  in place — modules under `src/modules/{workflow-ops,daemon-ops,...}`
  no longer call them directly, but the `DaemonControlClient` class
  itself still exposes them for daemon-self-checks and integration
  tests, and `kota-client.ts` does not yet shrink further on that
  axis.
- The wire code today issues:
  - `listRuns(filter)` → GET `/workflow/runs?workflow=<n>&limit=<n>&tag=<n>&causedByRunId=<id>`.
    Returns `{ runs: WorkflowRunSummary[] }` from
    `transport.request<...>("GET", `/workflow/runs${query}`)`. The
    inline closure flattens to `{ runs: result?.runs ?? [] }` so a
    transport-error `null` collapses to an empty list.
  - `status()` → GET `/workflow/status`. On `null` (transport error
    or non-ok) throws `"Daemon unreachable while reading workflow
    status"`. On success spreads `result` plus `pendingAbort: false`
    (the daemon-up branch always reports false because the daemon
    processes abort RPCs synchronously and never persists a stale
    abort signal file).
  - `pause()` / `resume()` → POST `/workflow/pause` / `/workflow/resume`.
    On `null` throws `"Daemon unreachable while pausing dispatch"` /
    `"Daemon unreachable while resuming dispatch"`. On success
    returns `{ paused: result.paused, already: result.already ?? false }`.
  - `abort()` → POST `/workflow/abort`. On `null` throws `"Daemon
    unreachable while aborting active runs"`. On success returns
    `{ status: "applied", count: result.aborted }` (the daemon-up
    branch never returns the `signaled` arm — that's the
    daemon-down local handler's contract).
  - `reload()` → POST `/workflow/reload`. On `null` throws `"Daemon
    unreachable while reloading definitions"`. On success returns
    `{ status: "applied", count: result.count }` (the daemon-up
    branch never returns the `signaled` arm).
  - `enable(name)` / `disable(name)` → POST
    `/workflow/definitions/<encodeURIComponent(name)>/enable` /
    `/disable`. On `null` throws `"Daemon unreachable while
    enabling/disabling workflow \"${name}\""`. On 404 returns
    `{ ok: false, reason: "not_found" }`. On success returns
    `{ ok: true }`.
  - `cancelRun(id)` → DELETE
    `/workflow/runs/<encodeURIComponent(id)>`. On `null` throws
    `"Daemon unreachable while cancelling run \"${id}\""`. On 404
    returns `{ ok: false, reason: "not_found" }`. On 409 returns
    `{ ok: false, reason: "active" }`. On success returns
    `{ ok: true }`.
  - `abortRun(id)` → POST
    `/workflow/runs/<encodeURIComponent(id)>/abort`. On `null` throws
    `"Daemon unreachable while aborting run \"${id}\""`. On 404
    returns `{ ok: false, reason: "not_found" }`. On 409 returns
    `{ ok: false, reason: "queued" }`. On success returns
    `{ ok: true }`.
  - `getRun(id)` → GET
    `/workflow/runs/<encodeURIComponent(id)>`. On `null` returns
    `{ found: false }`; on success returns `{ found: true, run }`.
    The daemon-up branch does not throw on transport failure here —
    it falls through to `{ found: false }`, matching today's
    closure behavior at lines 319-322.
  - `listDefinitions()` → GET `/workflow/definitions`. On `null`
    throws `"Daemon unreachable while listing workflow definitions"`.
    On success returns `{ source: "daemon", definitions: result.definitions }`.
  - `triggerByName(name, options)` → POST `/workflow/trigger` with
    JSON body `{ name, ...(tags && tags.length > 0 && { tags }),
    ...(payload && { payload }) }` where `tags` and `payload` are
    extracted from the options through `buildTriggerHttpPayload`
    (only the user-extension `payload` survives — `event`, `runId`,
    `force`, and `notBeforeMs` are honored only on the daemon-down
    enqueue path; the daemon imposes its own `event="manual"` and
    server-generated `_runId`). On `null` throws `"Daemon unreachable
    while triggering workflow \"${name}\""`. On 409 returns `{ ok:
    false, reason: "already_queued" }`. On success returns `{ ok:
    true, path: "daemon", queued: result.queued ?? name, ...(result.runId
    !== undefined && { runId: result.runId }) }`.
- The workflow-ops module's local consumer (`index.ts`) currently
  imports `WorkflowClient` from `#core/server/kota-client.js` (line
  19). After the migration, the new `client.ts` declares
  `WorkflowClient` plus the 15 supporting types alongside the local
  factory; `index.ts` imports `WorkflowClient` from `./client.js`.
  `WorkflowTriggerOptions` is also consumed by
  `src/modules/workflow-ops/execution/trigger.ts` and
  `src/modules/workflow-ops/execution/control.ts`; both update their
  imports to `./client.js` paths under the same module.
- One internal consumer outside the module: `src/modules/cli/navigator.test.ts`
  imports `WorkflowRunsListResult` for assertions. After the
  migration, the import path becomes
  `#modules/workflow-ops/client.js`; the `no-module-imports-in-core`
  guard does not apply (the importer is itself a module test).

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes. After this
migration lands, no namespace closures remain in
`buildCoreStubDaemonClientHandlers` — the function returns an empty
`{}` (or the helper itself can be removed entirely; see the
`Constraints` note below for the decision). The remaining
`daemon-client.ts` content is the typed transport composer, the 14
non-namespace direct `DaemonControlClient` methods (which still hold
~13 helpers as their backing implementations), and the
`assembleDaemonClientHandlers` validator. Driving `daemon-client.ts`
under the 300-line guideline beyond this task requires removing or
relocating the non-namespace direct methods themselves, which is
outside this task's scope and is the natural next follow-up after
this lands.

## Desired Outcome

`workflow` is the twenty-seventh and final namespace to leave
`src/core/server/` end-to-end through the `daemonClient(link)`
foundation hook:

- `WorkflowClient`, `WorkflowRunsListFilter`, `WorkflowRunsListResult`,
  `WorkflowStatusSnapshot`, `WorkflowPauseResult`,
  `WorkflowAbortResult`, `WorkflowReloadResult`, `WorkflowEnableResult`,
  `WorkflowDisableResult`, `WorkflowCancelRunResult`,
  `WorkflowAbortRunResult`, `WorkflowDaemonRequiredResult`,
  `WorkflowGetRunResult`, `WorkflowTriggerOptions`,
  `WorkflowTriggerResult`, and `WorkflowDefinitionsResult` live in
  `src/modules/workflow-ops/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `WorkflowClient` from `#modules/workflow-ops/client.js` instead of
  declaring the types inline. The narrow `no-module-imports-in-core`
  allowlist already covers the `server/kota-client.ts` exception; no
  allowlist edit is needed.
- `src/modules/workflow-ops/index.ts` adds a
  `daemonClient: (link) => ({ workflow: buildWorkflowDaemonHandler(link) })`
  field on the `KotaModule` definition. The new
  `buildWorkflowDaemonHandler(link): WorkflowClient` factory returns
  the thirteen-method namespace handler whose methods route through
  the typed `DaemonTransport` link and preserve the byte-for-byte
  URL paths, verbs, JSON-body contracts, and reshape mappings from
  the inline closure (full table in `## Problem`). The factory
  inlines or re-exports the `buildTriggerHttpPayload` reshape helper
  so the trigger arm only forwards the user-extension `payload`.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `workflow` closure on `buildCoreStubDaemonClientHandlers` (the
  function either returns an empty `{}` for the still-required
  contract surface or is deleted entirely if
  `assembleDaemonClientHandlers` no longer needs a stub source —
  pick whichever produces the cleaner final shape under the 300-line
  guideline; preserve the symmetry with the existing local-side
  assembly path).
- `daemon-client.ts` no longer carries the
  `buildTriggerHttpPayload` helper or the `WorkflowTriggerOptions`
  type import — both move into `src/modules/workflow-ops/client.ts`
  (or its sibling factory file) alongside the new daemon-side
  handler.
- The 13 namespace-only HTTP helpers in `daemon-client.ts` —
  `getWorkflowStatusHttp`, `getWorkflowDefinitionsHttp`, `pauseHttp`,
  `resumeHttp`, `abortHttp`, `reloadHttp`, `enableWorkflowHttp`,
  `disableWorkflowHttp`, `triggerWorkflowHttp`, `abortRunHttp`,
  `cancelRunHttp`, `listWorkflowRunsHttp`, `getWorkflowRunHttp` —
  **stay in place** because the non-namespace direct methods on
  `DaemonControlClient` (`pause`, `resume`, `abort`, `reload`,
  `enableWorkflow`, `disableWorkflow`, `trigger`, `abortRun`,
  `cancelRun`, `listWorkflowRuns`, `getWorkflowRun`,
  `getWorkflowStatus`, `getWorkflowDefinitions`, `dryRun`) on the
  class still consume them. Removing those direct methods is
  outside this task's scope and tracked separately as the next
  follow-up.
- `STUB_OMITTED_NAMESPACES` in
  `src/core/server/daemon-client.test.ts` gains `"workflow"`; the
  per-namespace closure-coverage check stops asserting that the core
  stub still ships a `workflow` closure (mirrors how
  `daemon-client.test.ts` already excludes the prior 26 migrated
  namespaces).
- `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` gains a `workflow`
  stub with placeholder closures for every method:
  `listRuns: async () => ({ runs: [] })`,
  `status: async () => ({ activeRuns: [], pendingRuns: [], queueLength: 0, completedRuns: 0, workflows: {}, paused: false, pendingAbort: false, agentConcurrency: 1, codeConcurrency: 4 })`,
  `pause: async () => ({ paused: true, already: false })`,
  `resume: async () => ({ paused: false, already: false })`,
  `abort: async () => ({ status: "applied" as const, count: 0 })`,
  `reload: async () => ({ status: "applied" as const, count: 0 })`,
  `enable: async () => ({ ok: false as const, reason: "not_found" as const })`,
  `disable: async () => ({ ok: false as const, reason: "not_found" as const })`,
  `cancelRun: async () => ({ ok: false as const, reason: "not_found" as const })`,
  `abortRun: async () => ({ ok: false as const, reason: "not_found" as const })`,
  `getRun: async () => ({ found: false as const })`,
  `listDefinitions: async () => ({ source: "static" as const, definitions: [] })`,
  `triggerByName: async () => ({ ok: false as const, reason: "already_queued" as const })`.
- All existing workflow daemon-up CLI behaviors continue to work
  byte-for-byte:
  - `kota workflow run list [--workflow N] [--limit N] [--tag T] [--caused-by-run R]`
    populates from the daemon's `/workflow/runs` endpoint with the
    same filtering and rendering.
  - `kota workflow run show <id>` produces the same body.
  - `kota workflow status` produces the same `paused`,
    `dispatchWindowBlocked`, queue length, and active-run rendering.
  - `kota workflow pause` / `resume` / `abort` / `reload` produce
    the same applied / signaled summary text and exit codes.
  - `kota workflow trigger <name> [--tag ...] [--payload ...]`
    produces the same `queued`, `already-queued`, and error
    rendering across daemon-up and daemon-down.
  - `kota workflow definitions list` and `kota workflow definitions
    enable/disable <name>` produce the same source attribution and
    not-found summary text.

## Constraints

- One mechanism. Do not add a second public client surface or a
  second module-contribution path — the daemon-side handler
  registers through the `daemonClient(link)` factory on
  `KotaModule`.
- Preserve the byte-for-byte URL paths, HTTP verbs, query-param
  shapes, and request/response body shapes the daemon serves:
  `GET /workflow/status`, `GET /workflow/definitions`,
  `GET /workflow/runs`, `GET /workflow/runs/<id>`,
  `POST /workflow/pause`, `POST /workflow/resume`,
  `POST /workflow/abort`, `POST /workflow/reload`,
  `POST /workflow/definitions/<name>/enable`,
  `POST /workflow/definitions/<name>/disable`,
  `POST /workflow/trigger`, `POST /workflow/runs/<id>/abort`,
  `DELETE /workflow/runs/<id>`. This is an internal refactor, not a
  protocol change.
- Preserve the throw-on-`null` semantics for the 11 methods that
  throw today (`status`, `pause`, `resume`, `abort`, `reload`,
  `enable`, `disable`, `cancelRun`, `abortRun`, `listDefinitions`,
  `triggerByName`) and the soft-fall-through semantics for the 2
  that do not (`listRuns` returns `{ runs: [] }` on `null`,
  `getRun` returns `{ found: false }` on `null`). The error
  messages must match the existing strings byte-for-byte so
  surfaced CLI output does not change.
- Preserve the `buildTriggerHttpPayload` reshape semantics: only
  the user-extension `payload` from `WorkflowTriggerOptions`
  reaches the daemon's HTTP body; `event`, `runId`, `force`, and
  `notBeforeMs` are honored only on the daemon-down enqueue path
  and remain on `WorkflowTriggerOptions` because the local handler
  (`workflow-ops/index.ts:219-242`) consumes them.
- The new daemon-side factory composes against the
  `DaemonTransport` link's typed `request<T>` / `fetchRaw` /
  `authHeaders()` / `baseUrl` primitives. Do not pass through to
  `node:http`, the bearer token, or `.kota/daemon-control.json`
  directly.
- The 13 namespace-only HTTP helpers
  (`getWorkflowStatusHttp`, `getWorkflowDefinitionsHttp`,
  `pauseHttp`, `resumeHttp`, `abortHttp`, `reloadHttp`,
  `enableWorkflowHttp`, `disableWorkflowHttp`,
  `triggerWorkflowHttp`, `abortRunHttp`, `cancelRunHttp`,
  `listWorkflowRunsHttp`, `getWorkflowRunHttp`) **stay in
  `daemon-client.ts`**. They still back the non-namespace direct
  methods on `DaemonControlClient`. Do not duplicate their bodies
  inside the new module factory — the module factory composes on
  the typed link directly (matching the pattern set by the prior
  26 pilots), and the daemon-client helpers continue to back the
  class methods. After this migration the helpers and the module
  factory implement the same wire calls independently against the
  same routes; that duplication is acceptable for one cycle and
  resolves naturally when the next follow-up removes the
  non-namespace direct methods from `DaemonControlClient`.
- No legacy or compatibility shim. Delete the inline `workflow`
  closure, the `buildTriggerHttpPayload` helper, and the
  `WorkflowTriggerOptions` type import from `daemon-client.ts` in
  the same change; do not leave deprecation re-exports.
- The `src/core/server/kota-client-namespace-types-guard.test.ts`
  guard test continues to pass without modification — adding a new
  module file with `client.ts` and removing the centralized
  declarations matches the existing invariant.

## Done When

- `WorkflowClient` and its 15 supporting result/option types live
  in `src/modules/workflow-ops/client.ts`.
  `src/core/server/kota-client.ts` imports `WorkflowClient` from
  there and no longer declares the workflow-namespace types
  inline. The file shrinks by ~150 lines from 351 to ~205 — under
  the 300-line guideline for the first time.
- `src/modules/workflow-ops/index.ts` declares
  `daemonClient: (link) => ({ workflow: buildWorkflowDaemonHandler(link) })`
  on the `KotaModule` and exports a
  `buildWorkflowDaemonHandler(link)` factory returning a
  `WorkflowClient` whose 13 methods preserve the byte-for-byte URL
  paths, verbs, JSON-body shapes, and reshape contracts above. The
  `buildTriggerHttpPayload` helper moves into the same module
  alongside the factory.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `workflow` closure, the `buildTriggerHttpPayload` helper, or the
  `WorkflowTriggerOptions` type import. The file shrinks by ~95
  lines from 630 to ~535 — still over the 300-line guideline; the
  next follow-up (removing the non-namespace direct methods on
  `DaemonControlClient`) drives it under the limit.
- `STUB_OMITTED_NAMESPACES` in `daemon-client.test.ts` includes
  `"workflow"`; `buildMigratedNamespaceTestStubs()` in
  `daemon-client-test-stubs.ts` ships a `workflow` no-op stub with
  the 13-method placeholder shapes listed in `## Desired Outcome`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/workflow-ops/daemon-client.test.ts`) exercises the
  wire shape against a recording `DaemonTransport`, mirroring the
  prior pilots' tests. The test pins (1) the factory contributes
  `workflow`, (2) each of the 13 methods routes through the
  expected HTTP method + path with the expected query/body shape,
  (3) the success arm decodes correctly for each method, (4) the
  throw-on-`null` arm fires with the byte-for-byte error string
  for each of the 11 methods that throw today, (5) `listRuns` and
  `getRun` soft-fall through on `null`, (6) `triggerByName`
  forwards only the user-extension `payload` after
  `buildTriggerHttpPayload`, (7) the assembly satisfies coverage
  with the workflow contribution, and (8) the assembly throws
  naming `"workflow"` when the contribution is removed.
- The workflow-ops module's `AGENTS.md` is updated to mention the
  new `buildWorkflowDaemonHandler` factory as the daemon-side
  surface (matching the level of detail in the daemon-ops
  `AGENTS.md` for `buildSessionsDaemonHandler` and
  `buildDaemonOpsDaemonHandler`).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Daemon-up and daemon-down CLI transcripts under the run
  directory (`.kota/runs/<run-id>/transcript.txt`) demonstrate
  parity for at least one read (`kota workflow status` or
  `kota workflow run list`) and one mutation (`kota workflow
  pause` or `kota workflow trigger <name>`) on each of the two
  transports. Run `kota workflow resume` to clean up if the
  transcript leaves the dispatch loop paused.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T07-28-08-437Z-explorer-u898ko/` after the
tasks namespace migrated (commit `c7a42aca`, 2026-05-05). One
namespace (`workflow`) remains centralized; this is the largest of
the 27 because it has 13 methods and 13 HTTP helpers, but its scope
is bounded — the helpers stay in `daemon-client.ts` because the
non-namespace direct methods on `DaemonControlClient` (audited and
left in place by the orthogonal `task-decouple-non-namespace-daemon-transport-methods-fr`
task, commit `a0a5e3e2`, 2026-05-03) still consume them. After this
migration lands, the next follow-up removes the non-namespace
direct methods themselves, driving `daemon-client.ts` under the
300-line guideline and closing the parent task.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the
owning module, with `src/core/` reduced to genuine cross-cutting
protocols and runtime primitives. This is the twenty-seventh and
final per-namespace follow-up of the parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` in
`blocked/` (decompose-into-foundation-plus-pilot-plus-follow-ups
chunking strategy, validated by 26 prior successful migrations).

## Acceptance Evidence

- Diff covering the move of `WorkflowClient` and its 15 supporting
  result/option types from `src/core/server/kota-client.ts` into
  `src/modules/workflow-ops/client.ts`, the new
  `buildWorkflowDaemonHandler(link)` factory and
  `buildTriggerHttpPayload` helper relocation in
  `src/modules/workflow-ops/index.ts`, the deletion of the inline
  `workflow` closure plus `buildTriggerHttpPayload` plus the
  `WorkflowTriggerOptions` type import from `daemon-client.ts`,
  and the `STUB_OMITTED_NAMESPACES` + `buildMigratedNamespaceTestStubs`
  entries.
- Line-count snapshots of `src/core/server/kota-client.ts` (before:
  351, after: ~205, under the 300-line guideline) and
  `src/core/server/daemon-client.ts` (before: 630, after: ~535,
  still over the 300-line guideline).
- Daemon-up and daemon-down CLI transcripts under the run
  directory (`.kota/runs/<run-id>/transcript.txt`) showing one read
  (`kota workflow status` or `kota workflow run list`) and one
  mutation (`kota workflow pause`/`resume` or `kota workflow
  trigger <name>`) producing identical output across both
  transports.
- Test output showing `pnpm typecheck`, `pnpm lint`, and the
  focused `pnpm test --filter daemon-client` plus `pnpm test
  --filter workflow-ops` pass on the changed tree, and the
  `STUB_OMITTED_NAMESPACES` coverage check in
  `daemon-client.test.ts` no longer asserts a core-stub
  `workflow` closure.
