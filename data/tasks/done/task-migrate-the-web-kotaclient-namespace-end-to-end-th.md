---
id: task-migrate-the-web-kotaclient-namespace-end-to-end-th
title: Migrate the web KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move WebStartOptions, WebStartResult, and WebClient from src/core/server/kota-client.ts into src/modules/web/client.ts; add a daemonClient(_link) factory on webModule contributing the web namespace as a stub-only handler that returns { ok: false, reason: 'daemon_required' } without touching the link transport; remove the inline web closure and the WebStartResult import from src/core/server/daemon-client.ts.
created_at: 2026-05-04T12:29:24.110Z
updated_at: 2026-05-04T12:39:46.898Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), the skills migration (`f62bbb65`), and the
mcpServer migration (`10877651`, 2026-05-04) have validated the
`daemonClient(link)` foundation pattern by moving eleven namespaces out
of `src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 16 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 1411 lines, `daemon-client.ts` is 1876 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that meaningfully extends the pattern is
`web`:

- 1 method (`start(options)`) — owned by the `web` module which already
  exposes a `localClient(ctx)` factory but not yet a
  `daemonClient(link)` factory. Adding the factory contributes the
  smallest possible namespace shape — a single mutation arm whose
  daemon-side handler is a fixed stub that **never touches the link
  transport** because the underlying capability (a long-running HTTP
  API server with SSE streaming and the embedded web UI) cannot be
  daemon-served in another address space. The local handler runs
  `kota serve` in the operator's address space; the daemon-side handler
  refuses uniformly with `{ ok: false, reason: "daemon_required" }`
  so the CLI maps that to a clear "stop the daemon first" hint.
- ~34 lines of namespace-owned types in `kota-client.ts` (lines
  1089–1122):
  - `WebStartOptions` (lines 1097–1102, 6 lines): the
    `{ port: number; model?: string; verbose?: boolean; noAuth?: boolean }`
    boot options.
  - `WebStartResult` (lines 1115–1118, 4 lines): the discriminated
    `{ ok: true } | { ok: false; reason: "daemon_required" } | { ok: false; reason: "missing_api_key" }`
    envelope.
  - `WebClient` interface (lines 1120–1122, 3 lines).
  - The supporting doc comments (lines 1089–1096, 1104–1114).
- 3 lines of stub code in `daemon-client.ts`:
  - The inline `web: { start }` closure on the central handler builder
    (lines 1482–1484), whose body is the literal
    `({ ok: false, reason: "daemon_required" })` constant — no
    `fetchWithTimeout`, no transport call, no HTTP route.
- 1 import in `daemon-client.ts` (`WebStartResult` from
  `./kota-client.js` at line 80) that goes away with the inline closure.

`WebClient`, `WebStartOptions`, and `WebStartResult` are also imported by:

- `src/modules/web/web-operations.ts`: imports `WebClient`,
  `WebStartOptions`, and `WebStartResult` from
  `#core/server/kota-client.js` today (lines 24–28).

That import shifts to `./client.js` after the migration. The file does
not gain a `#modules/*` cross-module import; it already lives inside
`web/`.

The migration generalizes the precedent the mcpServer migration
established:

1. **Stub-only daemon-side handler that never touches the link
   transport — second instance.** The mcpServer migration was the first
   namespace whose daemon-side semantics were intentionally **not
   daemon-served**, validating that the foundation hook supports
   namespaces whose entire daemon contract is a constant refusal.
   `web.start` is the only other namespace today with that exact shape,
   and validating that two independent modules can register stub-only
   `daemonClient(_link)` factories proves the precedent generalizes
   beyond a single special case. After this migration, every remaining
   centralized namespace in `daemon-client.ts` issues at least one wire
   call, so the stub-only contribution path is fully retired from
   core's responsibilities. The `WebStartResult` envelope's three-arm
   discriminated union (one ok arm, two distinct refusal reasons —
   `daemon_required` and `missing_api_key`) also exercises a slightly
   richer typed result than mcpServer's two-arm union, with the
   daemon-side handler picking the `daemon_required` arm uniformly
   while preserving the `missing_api_key` arm for the local-side
   handler's existing error semantics.

## Desired Outcome

`web` is the twelfth namespace to leave `src/core/server/` end-to-end
through the `daemonClient(link)` foundation hook:

- `WebClient`, `WebStartOptions`, and `WebStartResult` live in
  `src/modules/web/client.ts`. The aggregate `KotaClient` interface in
  `src/core/server/kota-client.ts` imports `WebClient` from the module
  instead of declaring the types inline. The narrow
  `no-module-imports-in-core` allowlist (today: `server/kota-client.ts`)
  already covers the import; no allowlist edit is needed.
- `src/modules/web/index.ts` adds a `daemonClient(_link)` factory
  contributing the `web` namespace. The factory returns `{ web }` whose
  `start` method ignores the `_link` parameter and returns the fixed
  `{ ok: false, reason: "daemon_required" as const }` arm — no
  `link.request*` call, no transport reach. The factory intentionally
  exercises the stub-only shape: the `link` parameter is named `_link`
  to mark it unused, mirroring `mcpServerModule.daemonClient(_link)`
  established in the prior pilot.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `web: { start }` closure on the core-side stub builder, nor the
  `WebStartResult` import from `./kota-client.js`.
- `src/modules/web/web-operations.ts` imports `WebClient`,
  `WebStartOptions`, and `WebStartResult` from `./client.js` instead of
  `#core/server/kota-client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/web/daemon-client.test.ts`, mirroring the existing
  `src/modules/mcp-server/daemon-client.test.ts` and
  `src/modules/skill-ops/daemon-client.test.ts`) exercises the
  stub-only shape against a recording `DaemonTransport`. The test pins
  (1) the factory contributes `web`, (2) `start` returns
  `{ ok: false, reason: "daemon_required" }` regardless of the options
  passed in (including all `WebStartOptions` field combinations:
  port-only, port+model, port+verbose, port+noAuth, all-options), (3)
  `start` issues **no** `request` / `requestStrict` / `fetchRaw` /
  `events` call against the transport — proven by a recording transport
  that throws on every method except the no-op `authHeaders`, (4)
  coverage success when the contribution is supplied and coverage
  failure when it is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"web"`, and `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `web` handler returning the same
  `{ ok: false, reason: "daemon_required" }` constant so tests that
  build a `DaemonControlClient` purely to exercise non-namespace
  daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. The `web.start` daemon-side semantics do not
  change: the daemon-side handler continues to return
  `{ ok: false, reason: "daemon_required" }` for every invocation. No
  new daemon route is introduced and no existing route is touched.
- The daemon-side handler does **not** call `link.request`,
  `link.requestStrict`, `link.fetchRaw`, `link.events`, or
  `link.authHeaders`. The `_link` parameter is intentionally unused.
  This generalizes the load-bearing shape mcpServer established to a
  second independent module.
- Strict error handling. The daemon-side handler returns the typed
  `{ ok: false, reason: "daemon_required" }` arm directly; it does not
  throw. The local handler's existing error semantics (the
  `missing_api_key` and `daemon_required` arms surfaced by
  `localWebClient.start` and the CLI's branching on `result.reason`)
  are unchanged and remain in `web-operations.ts` and `index.ts`.
- The three-arm `WebStartResult` discriminated union is preserved
  exactly. The local handler today emits `{ ok: true }` on success;
  the `missing_api_key` arm is part of the typed contract and remains
  available for future local-handler use; the `daemon_required` arm is
  emitted by the daemon-side handler. None of these arms are removed
  or renamed.
- No legacy or compatibility surface. Delete the inline closure, the
  central type declarations, and the `WebStartResult` import at the
  migration's edges as it completes; do not leave shims. The in-module
  import shift in `web-operations.ts` from `#core/server/kota-client.js`
  to `./client.js` is a hard cutover, not a parallel re-export.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts` continues
  to pass and rejects deliberately re-introduced per-namespace
  `WebStartOptions` / `WebStartResult` declarations in
  `src/core/server/`. Existing assertions for the doctor, harnessParity,
  audit, retract, answer, ownerQuestions, modules, modulesAdmin,
  agents, skills, and mcpServer migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota serve [-p <port>] [-m <model>]
  [-v] [--no-auth]`), daemon-up vs daemon-down branching, and error
  output all continue to behave identically. The daemon-up branch emits
  the same "Cannot start `kota serve` while a daemon is running" error
  message the operator sees today, and the `missing_api_key` branch
  continues to emit the existing "No API key configured" message.
- Output continues to flow through `src/modules/rendering`. The web
  module's existing `console.error`-on-refusal path in `index.ts` is
  not part of this refactor.

## Done When

- `src/modules/web/client.ts` declares `WebClient`, `WebStartOptions`,
  and `WebStartResult`. The `KotaClient` aggregate in
  `src/core/server/kota-client.ts` imports `WebClient` from this
  module.
- `src/modules/web/index.ts` adds a `daemonClient(_link)` factory
  contributing the `web` namespace, returning `{ web }` whose `start`
  method is a stub-only handler. The factory body does not reach into
  the typed `DaemonTransport`, `node:http`, the bearer token, or
  `.kota/daemon-control.json`.
- `src/modules/web/web-operations.ts` imports `WebClient`,
  `WebStartOptions`, and `WebStartResult` from `./client.js` (not from
  `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any web-specific
  code: no inline `web: { start }` closure on the core-side stub
  builder, and no `WebStartResult` import from `./kota-client.js`.
- `src/modules/web/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory presence,
  stub return value invariant across all `WebStartOptions` field
  combinations, zero-transport-call invariant, coverage success when
  the contribution is supplied and coverage failure when it is
  removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"web"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `web` handler.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `WebStartOptions` /
  `WebStartResult` declarations in `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`web-daemon-up.txt` / `web-daemon-down.txt`) demonstrate parity for
  `kota serve` showing the pre/post output is identical across modes
  (daemon-up: refusal message + non-zero exit; daemon-down: server boot
  to the first listening-port log line or a `missing_api_key` error,
  depending on the operator environment — whichever branch the
  pre-migration build emits, the post-migration build emits the same).

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-04T12-27-18-900Z-explorer-8saz73/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Thirteen orthogonal preludes have already landed (twelve foundation/
pilot commits plus the mcpServer migration):

- `a0a5e3e2` — typed `DaemonTransport` plus non-namespace transport-
  method decoupling (the orthogonal prelude needed under all chunking
  answers).
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
- `eb392cd1` — answer migration extending the pattern to a multi-verb
  namespace mixing POST + GET + GET-with-path-id.
- `68b74850` — ownerQuestions migration extending the pattern to two
  POSTs sharing an id-bearing path stem.
- `c143c892` — modules migration extending the pattern to the smallest
  single-method namespace.
- `03485329` — modulesAdmin migration extending the pattern to the
  first multi-namespace contribution from a single module's
  `daemonClient(link)` factory and the first cross-namespace
  dependency consumption.
- `7965beb6` — agents migration extending the pattern to the first
  pure read-only namespace shape (two GETs) and validating the
  single-status-code → 200 alignment precedent for `404 →
  { found: false }`.
- `f62bbb65` — skills migration extending the pattern to the first
  multi-status-code → 200 alignment for a typed mutation result
  (collapsing `502` and `400` not-ok arms into uniform `200`).
- `10877651` — mcpServer migration establishing the stub-only daemon-
  side handler precedent: the first namespace whose `daemonClient(_link)`
  factory ignores the link transport and returns a fixed constant
  refusal because the underlying capability is a long-running stdio
  server in the operator's address space.

`web` is the natural next pilot. It is the only other unmigrated
namespace today whose entire daemon contract is a constant refusal —
the underlying capability is `kota serve`, a long-running HTTP API
server with SSE streaming and the embedded web UI that cannot be
started in the daemon process. Validating that two independent modules
can each register stub-only `daemonClient(_link)` factories generalizes
the precedent the mcpServer migration established beyond a single
special case, and after this migration every remaining centralized
namespace in `daemon-client.ts` issues at least one wire call — so the
stub-only contribution path is fully retired from core's
responsibilities and the remaining migrations all exercise the link
transport. The migration is needed under every chunking answer the
owner can pick (a/b/c/d/unblock): the web namespace migrates exactly
once regardless of whether the parent lands in one cohesive run or
fans out across follow-ups, so this task does not commit the owner to
any specific chunking answer; it shrinks the parent task's scope by
one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type moves out of `src/core/server/`, the new
  `daemonClient(_link)` factory on `webModule`, the in-module import
  shift in `web-operations.ts`, the removed inline closure and
  `WebStartResult` import from `src/core/server/daemon-client.ts`, and
  the new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~34-line and ~5-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`web-daemon-up.txt` / `web-daemon-down.txt`) exercising `kota serve`
  with identical output across modes (daemon-up shows the refusal
  message; daemon-down shows whichever branch the pre-migration build
  emits — server-listening line or `missing_api_key` error).
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `WebStartOptions` /
  `WebStartResult` declaration in `src/core/server/`.
