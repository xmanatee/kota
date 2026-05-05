---
id: task-migrate-the-daemonops-kotaclient-namespace-end-to-
title: Migrate the daemonOps KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move DaemonOpsClient interface and DaemonOpsStatusResult/DaemonOpsPidResult/DaemonOpsStopResult/DaemonOpsReloadResult types from src/core/server/kota-client.ts into src/modules/daemon-ops/client.ts; extend the daemon-ops module's daemonClient(link) factory (which already contributes sessions) to also contribute the daemonOps namespace handler wiring GET /status and POST /reload through the typed DaemonTransport while throwing on the daemon-up stop arm; remove the inline daemonOps handler closure from buildCoreStubDaemonClientHandlers and leave getDaemonStatusHttp/reloadConfigHttp/daemonManagedHttp in src/core/server/daemon-client.ts only because non-namespace direct methods (getDaemonStatus, reloadConfig) on DaemonControlClient still consume getDaemonStatusHttp/reloadConfigHttp.
created_at: 2026-05-05T05:42:55.850Z
updated_at: 2026-05-05T05:56:18.652Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), the
mcpServer migration (`10877651`), the web migration (`f79a2ee5`), the
capture migration (`e0e9aa93`), the recall migration (`5ab2bd0b`), the
webhook migration (`201d35ce`), the approvals migration (`e0030ada`),
the secrets migration (`5841c7f0`), the memory migration (`5bcc9e24`),
the knowledge migration (`d346a5c7`), the history migration
(`a38978c8`), the evalHarness migration (`d3afe7e7`), the voice
migration (`24d0ebed`), and the sessions migration (`84a52d7e`,
2026-05-05) have validated the `daemonClient(link)` foundation pattern
by moving twenty-three namespaces out of `src/core/server/kota-client.ts`
and `src/core/server/daemon-client.ts` into their owning modules.
4 namespaces still have their TypeScript shape and daemon-side wire
code centralized in those two files (`kota-client.ts` is 612 lines,
`daemon-client.ts` is 994 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that fits the same multi-method
end-to-end shape is `daemonOps`, named explicitly as the next
follow-up in the sessions migration's `## Problem` section ("the
`daemonOps` namespace owned by the same module is the next
follow-up"):

- 4 methods (`status()`, `pid()`, `stop(options)`, `reload()`) — all
  owned by the same module (`daemon-ops`) that already contributes
  the freshly-migrated `sessions` namespace plus the `daemonOps`
  local handler at `src/modules/daemon-ops/index.ts:478-491`.
- The shape extends the pattern in two new dimensions the prior
  pilots did not exercise:
  - **First migration with a daemon-side method that throws by
    construction.** `daemonOps.stop` cannot run on the daemon-up
    branch — the daemon cannot SIGTERM itself — so the daemon-side
    factory's `stop` arm throws `"daemonOps.stop is owned by the
    local handler — the daemon cannot SIGTERM itself."` (matching
    today's lines 702-706 behavior). The selector picks the daemon
    transport only when a daemon is reachable, but the local
    `daemonOps.stop` is what operator CLIs end up calling — the
    daemon-up factory exists for shape coverage, not for runtime
    use.
  - **First migration where two namespace methods share a single
    underlying daemon route.** Both `status()` and `pid()` derive
    from the same `GET /status` response (`getDaemonStatusHttp`):
    `status` wraps the full `DaemonLiveStatus` and probes
    `daemonManagedHttp`, while `pid()` extracts the `pid` field
    only. The daemon-side factory must call the typed link's `GET
    /status` independently in each method (no caching across calls
    — matching today's pre-migration behavior at lines 687-701).
- The owning module (`src/modules/daemon-ops/`) already contributes
  the `sessions` namespace through `daemonClient: (link) => ({
  sessions: buildSessionsDaemonHandler(link) })` at
  `src/modules/daemon-ops/index.ts:494`. This migration extends that
  return value to also contribute `daemonOps`, sharing the same
  module factory.
- ~85 lines of namespace-owned types in `kota-client.ts` (lines
  472-519):
  - `DaemonOpsStatusResult` (lines 482-485, 4 lines): the
    three-arm `{ state: "running"; managed: boolean; status:
    DaemonLiveStatus } | { state: "not_running"; managed: boolean }
    | { state: "stale"; managed: boolean; pid: number }`
    discriminated union.
  - `DaemonOpsPidResult` (lines 488-491, 4 lines): the three-arm
    `{ state: "running"; pid: number } | { state: "not_running" } |
    { state: "stale"; pid: number }` discriminated union.
  - `DaemonOpsStopResult` (lines 494-498, 5 lines): the four-arm
    `{ ok: true } | { ok: false; reason: "not_running" | "stale" |
    "timeout"; pid?: number }` discriminated union (with `pid`
    carried on `stale` and `timeout` arms).
  - `DaemonOpsReloadResult` (lines 501-504, 4 lines): the three-arm
    `{ ok: true; workflows: number; changedModules: string[] } |
    { ok: false; reason: "not_running" | "reload_failed" }`
    discriminated union.
  - `DaemonOpsClient` (lines 514-519, 6 lines).
  - The supporting doc comments (lines 472-481, 487, 493, 500,
    506-513).
- ~30 lines of inline namespace-handler closure in
  `daemon-client.ts` — the `daemonOps: { status, pid, stop,
  reload }` closure on the central handler builder (lines 686-712,
  27 lines), plus the `DaemonOpsClient` type import from
  `./kota-client.js` (which today imports through the
  re-export); the `getDaemonStatusHttp` (line 369-373),
  `reloadConfigHttp` (line 423-427), and `daemonManagedHttp` (line
  522-524) helper functions stay in `daemon-client.ts` because the
  non-namespace direct methods `DaemonControlClient.getDaemonStatus()`
  (line 868-870) and `DaemonControlClient.reloadConfig()` (line
  904-906) on the class still consume them — those direct methods
  bridge `kota serve` ⇄ daemon and are not part of the `daemonOps`
  namespace contract. The orthogonal
  `task-decouple-non-namespace-daemon-transport-methods-fr` task
  audited these methods and left them in place.
- The wire code today issues GET `/status` (no body, returns
  `DaemonLiveStatus | null` from `transport.request`) for both
  `status()` and `pid()`, and POST `/reload` (no body, returns `{ ok:
  boolean; workflows: number; changedModules: string[] } | null`) for
  `reload()`. The `status()` arm reshapes to `{ state: "running",
  managed, status }` after probing `daemonManagedHttp` (which
  returns `false` on the daemon-up branch by construction — the
  daemon cannot determine if it is managed by an OS service unit
  on the operator's host). The `pid()` arm extracts `status.pid`
  and throws if the daemon response omits it (matching today's
  lines 696-700 behavior). The `reload()` arm maps `null` →
  `{ ok: false, reason: "reload_failed" }` and the success
  envelope to `{ ok: true, workflows, changedModules }`. The
  `stop()` arm throws unconditionally because the daemon cannot
  SIGTERM itself.
- The daemon-ops module's local consumer (`index.ts`) currently
  imports `DaemonOpsClient` from `#core/server/kota-client.js` (line
  10). After the migration, the new `client.ts` declares the
  `DaemonOpsClient` types alongside the already-migrated
  `SessionsClient` types; `index.ts` imports both from
  `./client.js` instead.

No cross-module state, no shared transport plumbing beyond the typed
`DaemonTransport` link the foundation already exposes — the same
shape as the prior pilots, with the two new dimensions noted above.

## Desired Outcome

`daemonOps` is the twenty-fourth namespace to leave
`src/core/server/` end-to-end through the `daemonClient(link)`
foundation hook:

- `DaemonOpsClient`, `DaemonOpsStatusResult`, `DaemonOpsPidResult`,
  `DaemonOpsStopResult`, and `DaemonOpsReloadResult` live in
  `src/modules/daemon-ops/client.ts` alongside the already-migrated
  `SessionsClient`, `SessionsListResult`, and
  `SessionsSetAutonomyModeResult` types. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `DaemonOpsClient` from this module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/daemon-ops/index.ts` extends its existing
  `daemonClient(link)` factory from
  `(link) => ({ sessions: buildSessionsDaemonHandler(link) })` to
  `(link) => ({ sessions: buildSessionsDaemonHandler(link),
  daemonOps: buildDaemonOpsDaemonHandler(link) })`. The new
  `buildDaemonOpsDaemonHandler(link): DaemonOpsClient` factory
  returns the four-method namespace handler whose methods route
  through:
  - `status()` → calls `link.request<DaemonLiveStatus>("GET",
    "/status")` (the typed transport request returns `null` on
    transport failure or non-ok response); on `null` throws
    `"Daemon unreachable while reading daemon status"`. On
    success, calls `daemonManagedHttp()` (the same helper the
    central stub uses — accept the conventional pattern of
    re-exporting the helper from `daemon-client.ts` or move it
    into the daemon-ops module if the daemon-ops factory is the
    only remaining caller after this migration; prefer keeping it
    in `daemon-client.ts` as a daemon-side primitive that any
    future namespace might want, since `daemonManagedHttp` is
    structurally a daemon-side property of the typed link rather
    than a `daemonOps`-specific helper). Returns `{ state:
    "running", managed, status }` matching today's lines 687-693
    reshape. The local handler is the only one that distinguishes
    `not_running` and `stale` arms — the daemon-up branch always
    reports `running` because the client only exists when the
    selector resolved to a daemon address.
  - `pid()` → calls `link.request<DaemonLiveStatus>("GET",
    "/status")`; on `null` or missing `status.pid` throws
    `"Daemon unreachable while reading daemon pid"`. On success,
    returns `{ state: "running", pid: status.pid }` matching
    today's lines 695-701 behavior.
  - `stop(_options)` → throws `"daemonOps.stop is owned by the
    local handler — the daemon cannot SIGTERM itself."` matching
    today's lines 702-706 behavior. The arm exists to satisfy the
    typed contract; runtime callers always reach the local handler.
  - `reload()` → calls `link.request<{ ok: boolean; workflows:
    number; changedModules: string[] }>("POST", "/reload")`; on
    `null` returns `{ ok: false, reason: "reload_failed" }`
    matching today's lines 707-710 behavior. On success returns
    `{ ok: true, workflows: result.workflows, changedModules:
    result.changedModules }`. Note: the daemon-up branch never
    returns `not_running` because the client only exists when the
    selector resolved to a daemon address — only the local handler
    emits `not_running`.

  matching today's `getDaemonStatusHttp` / `reloadConfigHttp` /
  `daemonManagedHttp` URL paths, HTTP verbs, JSON-body contracts,
  and reshape mappings byte-for-byte. The control-route stems
  (`/status`, `/reload`) are preserved.
- `src/core/server/daemon-client.ts` no longer carries the
  `daemonOps: { status, pid, stop, reload }` closure on the core-side
  stub builder. The `getDaemonStatusHttp`, `reloadConfigHttp`, and
  `daemonManagedHttp` helper functions stay because the
  non-namespace direct methods on `DaemonControlClient`
  (`getDaemonStatus`, `reloadConfig`) consume them, plus the
  `DaemonOpsClient` type import from `./kota-client.js` is removed
  from `daemon-client.ts` (replaced by the re-import from
  `#modules/daemon-ops/client.js` only on the kota-client.ts side
  via the aggregate composition).
- `src/modules/daemon-ops/index.ts` imports `DaemonOpsClient` from
  `./client.js` (the new module-local file) instead of from
  `#core/server/kota-client.js`. The `localClient` factory
  continues to compose `{ sessions: sessionsLocalClient(),
  daemonOps }` unchanged (the local handler implementation does
  not move).
- A new daemon-side factory unit test alongside the module
  (`src/modules/daemon-ops/daemon-ops-daemon-client.test.ts`)
  exercises the wire shape against a recording `DaemonTransport`,
  mirroring `src/modules/daemon-ops/sessions-daemon-client.test.ts`,
  `src/modules/voice/daemon-client.test.ts`,
  `src/modules/history/daemon-client.test.ts`, and the prior
  multi-method pilots. The test pins (1) the factory contributes
  `daemonOps` alongside `sessions`, (2) `status()` routes through
  `request("GET", "/status")` and decodes the success arm
  correctly: a `200 + { pid: 1234, startedAt: "...", workflow:
  {...}, sessions: [], ... }` response collapses to `{ state:
  "running", managed: false, status: <the same body> }` (managed
  defaults to `false` because `daemonManagedHttp` returns `false`
  on the daemon-up branch by construction), (3) `status()` throws
  on `null` (transport failure or non-ok response) with message
  containing `"Daemon unreachable"`, (4) `pid()` routes through
  `request("GET", "/status")` and decodes the success arm
  correctly: a `200 + { pid: 1234, ... }` response collapses to
  `{ state: "running", pid: 1234 }`, (5) `pid()` throws on `null`
  or missing `status.pid` with message containing `"Daemon
  unreachable"`, (6) `stop({ timeoutSec: 30 })` throws with
  message containing `"daemonOps.stop is owned by the local
  handler"`, (7) `reload()` routes through `request("POST",
  "/reload")` and decodes the success arm correctly: a `200 + {
  ok: true, workflows: 5, changedModules: ["m1"] }` response
  collapses to `{ ok: true, workflows: 5, changedModules: ["m1"] }`,
  (8) `reload()` decodes the reload_failed arm correctly: a `null`
  response (transport failure or non-ok) collapses to `{ ok:
  false, reason: "reload_failed" }`, (9) the assembly satisfies
  coverage with the daemonOps contribution, and (10) the assembly
  throws naming `"daemonOps"` when the contribution is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-
  client.test.ts` extends with `"daemonOps"`, and
  `buildMigratedNamespaceTestStubs()` in `src/core/server/daemon-
  client-test-stubs.ts` extends with a stub `daemonOps` handler
  whose four methods return placeholder shapes (`status()` →
  `{ state: "running", managed: false, status: <minimal
  DaemonLiveStatus stub> }`, `pid()` → `{ state: "running", pid:
  0 }`, `stop()` → throws or returns `{ ok: false, reason:
  "not_running" }`, `reload()` → `{ ok: false, reason:
  "reload_failed" }`) so tests that build a `DaemonControlClient`
  purely to exercise non-namespace daemon behavior continue to
  pass coverage.
- The daemon-ops module's `AGENTS.md` is updated to describe the
  new `buildDaemonOpsDaemonHandler` factory alongside
  `buildSessionsDaemonHandler` as the daemon-side surfaces the
  module contributes through `daemonClient(link)`. Any prior
  description of the central `daemonOps: { status, pid, stop,
  reload }` closure on `buildCoreStubDaemonClientHandlers` is
  removed.

## Constraints

- Foundation pattern only. Do not change the daemon HTTP routes.
  The `GET /status` and `POST /reload` routes keep their HTTP
  verbs, JSON-body contracts, and response shapes exactly as
  parsed in `src/core/daemon/daemon-control.ts`. The CLI-facing
  `kota daemon-ops` subcommands (`status`, `pid`, `stop`,
  `reload`) and the module's `status-cli.ts` formatting are
  unrelated to this migration and must not be touched.
- The daemon-side handler uses `link.request` through the typed
  `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json` directly.
- The non-namespace direct methods `getDaemonStatus()`,
  `reloadConfig()`, and the helpers `getDaemonStatusHttp`,
  `reloadConfigHttp`, `daemonManagedHttp` stay in
  `src/core/server/daemon-client.ts`. They are not part of the
  `daemonOps` namespace contract — they bridge serve ⇄ daemon and
  the orthogonal `task-decouple-non-namespace-daemon-transport-
  methods-fr` task already audited and left them in place. Do not
  displace them in this migration.
- `daemonManagedHttp` is the daemon-side stub that always returns
  `false` because the daemon cannot determine OS-service-unit
  managedness for the operator's host. The new factory consumes
  this stub via re-import from `daemon-client.ts` (not via a new
  daemon-ops-local copy), preserving the single source of truth
  for the daemon-up `managed` policy.
- The `STUB_OMITTED_NAMESPACES` and `buildMigratedNamespaceTestStubs`
  pattern is the established way to keep `daemon-client.test.ts`
  green for tests that build a `DaemonControlClient` without going
  through full module wiring — extend, do not bypass.
- No legacy or compatibility surface. Delete the old centralized
  type declarations and namespace handler closure as the migration
  completes; do not leave deprecation shims.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` are green. The new
  daemon-side factory test asserts wire-shape parity with the prior
  inline closure.
- Daemon-up and daemon-down CLI transcripts demonstrate parity for
  `kota daemon-ops status`, `kota daemon-ops pid`,
  `kota daemon-ops stop --timeout-sec 30`, and `kota daemon-ops
  reload` against the pre-migration behavior.

## Done When

- `DaemonOpsClient`, `DaemonOpsStatusResult`, `DaemonOpsPidResult`,
  `DaemonOpsStopResult`, and `DaemonOpsReloadResult` are declared in
  `src/modules/daemon-ops/client.ts` and removed from
  `src/core/server/kota-client.ts`. The `KotaClient` aggregate
  imports `DaemonOpsClient` from `#modules/daemon-ops/client.js`.
- `src/modules/daemon-ops/index.ts` adds a
  `buildDaemonOpsDaemonHandler(link): DaemonOpsClient` factory and
  extends its `daemonClient(link)` export to contribute both
  `sessions` and `daemonOps` namespace handlers.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `daemonOps: { status, pid, stop, reload }` closure on
  `buildCoreStubDaemonClientHandlers`. `getDaemonStatusHttp`,
  `reloadConfigHttp`, and `daemonManagedHttp` remain because the
  non-namespace `DaemonControlClient.getDaemonStatus()` and
  `DaemonControlClient.reloadConfig()` direct methods consume them.
- `STUB_OMITTED_NAMESPACES` in `daemon-client.test.ts` includes
  `"daemonOps"`. `buildMigratedNamespaceTestStubs()` in
  `daemon-client-test-stubs.ts` provides a stub `daemonOps` handler.
- A new `src/modules/daemon-ops/daemon-ops-daemon-client.test.ts`
  exercises the wire shape end-to-end (10 cases as enumerated in
  `## Desired Outcome`).
- The daemon-ops module's `AGENTS.md` reflects the
  `buildDaemonOpsDaemonHandler` daemon-side factory as the
  module's daemon-side surface for the `daemonOps` namespace.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Daemon-up and daemon-down CLI transcripts under the run
  directory show `kota daemon-ops status`, `kota daemon-ops pid`,
  `kota daemon-ops stop`, and `kota daemon-ops reload` produce
  the same operator output as before (allowing for runtime
  variance in pid / uptime fields).
- `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` shrink by the daemonOps
  namespace's share of lines (~85 lines in `kota-client.ts`,
  ~30 lines in `daemon-client.ts`). Neither file needs to be
  under the 300-line guideline at this task's completion — the
  remaining 3 namespaces (workflow, tasks, config) carry the
  bulk of the residual line count and migrate in their own
  follow-up tasks.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-05T05-40-23-324Z-explorer-e7k3o8/` after the
sessions migration landed at commit `84a52d7e` ("migrate sessions
KotaClient namespace through daemonClient(link) hook",
2026-05-05). The sessions migration's `## Problem` section
explicitly named `daemonOps` as the next follow-up: "the
`daemonOps` namespace owned by the same module is the next
follow-up." This task realizes that follow-up.

The parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` remains
blocked on the `kotaclient-namespace-distribution-chunking` owner
decision; per-namespace migration tasks (proposed answer (b))
have been the de-facto execution path since 2026-05-03 and have
moved 23 of 27 namespaces out of `src/core/server/`. This task
continues that cadence on the same orthogonal scope the parent
task's `## Decomposition Proposal` already named ("per-namespace
follow-ups"); landing it does not commit the owner to any
specific chunking answer.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the
owning module, with `src/core/` reduced to genuine cross-cutting
protocols and runtime primitives. After this migration, 3
namespaces remain centralized (`workflow`, `tasks`, `config`);
each will land in its own per-namespace migration task.

## Acceptance Evidence

- Diff covering the type moves out of
  `src/core/server/kota-client.ts` into
  `src/modules/daemon-ops/client.ts`, the
  `buildDaemonOpsDaemonHandler` factory and the extended
  `daemonClient(link)` export in `src/modules/daemon-ops/index.ts`,
  the `daemonOps` closure removal from
  `src/core/server/daemon-client.ts`, the
  `STUB_OMITTED_NAMESPACES` and `buildMigratedNamespaceTestStubs()`
  extensions, the new daemon-side factory test, and the
  daemon-ops `AGENTS.md` update.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after the
  migration showing the daemonOps share removed.
- New daemon-side factory test
  `src/modules/daemon-ops/daemon-ops-daemon-client.test.ts`
  passing.
- Daemon-up and daemon-down CLI transcripts under the run
  directory showing `kota daemon-ops status`, `kota daemon-ops
  pid`, `kota daemon-ops stop`, and `kota daemon-ops reload`
  produce the same operator output as before the migration.
