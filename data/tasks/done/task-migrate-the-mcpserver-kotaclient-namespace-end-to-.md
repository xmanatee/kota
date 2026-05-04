---
id: task-migrate-the-mcpserver-kotaclient-namespace-end-to-
title: Migrate the mcpServer KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: done
priority: p1
area: architecture
summary: Move McpServerClient, McpServerStartOptions, and McpServerStartResult from src/core/server/kota-client.ts into src/modules/mcp-server/client.ts; add a daemonClient(_link) factory on mcpServerModule contributing the mcpServer namespace as a stub-only handler that returns { ok: false, reason: 'daemon_required' } without touching the link transport; remove the inline mcpServer closure and the McpServerStartResult import from src/core/server/daemon-client.ts.
created_at: 2026-05-03T12:35:37.906Z
updated_at: 2026-05-04T12:24:51.945Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (`927dca24`), the audit migration (`b6278cf1`), the retract
migration (`8c212f0c`), the answer migration (`eb392cd1`), the
ownerQuestions migration (`68b74850`), the modules migration
(`c143c892`), the modulesAdmin migration (`03485329`), the agents
migration (`7965beb6`), and the skills migration (`f62bbb65`,
2026-05-03) have validated the `daemonClient(link)` foundation pattern
by moving ten namespaces out of `src/core/server/kota-client.ts` and
`src/core/server/daemon-client.ts` into their owning modules. 17
namespaces still have their TypeScript shape and daemon-side wire code
centralized in those two files (`kota-client.ts` is 1437 lines,
`daemon-client.ts` is 1880 lines, both still well over the 300-line
guideline).

The next-cleanest namespace that meaningfully extends the pattern is
`mcpServer`:

- 1 method (`start(options)`) — owned by the `mcp-server` module which
  already exposes a `localClient(ctx)` factory but not yet a
  `daemonClient(link)` factory. Adding the factory contributes the
  smallest possible namespace shape — a single mutation arm whose
  daemon-side handler is a fixed stub that **never touches the link
  transport** because the underlying capability (a long-running stdio
  MCP server) cannot be daemon-served. The local handler runs
  `kota mcp-server` in the operator's address space; the daemon-side
  handler refuses uniformly with `{ ok: false, reason: "daemon_required" }`
  so the CLI maps that to a clear "stop the daemon first" hint.
- ~22 lines of namespace-owned types in `kota-client.ts` (lines
  1123–1148):
  - `McpServerStartOptions` (lines 1130–1133, 4 lines): the
    `{ toolFilter?: string[]; name: string }` boot options.
  - `McpServerStartResult` (lines 1142–1144, 3 lines): the
    discriminated `{ ok: true } | { ok: false; reason: "daemon_required" }`
    envelope.
  - `McpServerClient` interface (lines 1146–1148, 3 lines).
  - The supporting doc comments (lines 1123–1129, 1135–1141).
- 4 lines of stub code in `daemon-client.ts`:
  - The inline `mcpServer: { start }` closure on the central handler
    builder (lines 1486–1488), whose body is the literal
    `({ ok: false, reason: "daemon_required" })` constant — no
    `fetchWithTimeout`, no transport call, no HTTP route.
- 1 import in `daemon-client.ts` (`McpServerStartResult` from
  `./kota-client.js` at line 49) that goes away with the inline closure.

`McpServerStartOptions`, `McpServerStartResult`, and `McpServerClient`
are also imported by:

- `src/modules/mcp-server/mcp-server-operations.ts`: imports
  `McpServerClient`, `McpServerStartOptions`, and `McpServerStartResult`
  from `#core/server/kota-client.js` today.

That import shifts to `./client.js` after the migration. The file does
not gain a `#modules/*` cross-module import; it already lives inside
`mcp-server/`.

The migration extends the foundation pattern in one axis the prior
ten pilots did not exercise:

1. **Stub-only daemon-side handler that never touches the link
   transport.** Every prior migrated namespace's `daemonClient(link)`
   factory either issued a `link.requestStrict<T>` call (single- or
   multi-status-code → 200 alignment) or composed at least one wire
   call per method. `mcpServer.start` is the first namespace whose
   daemon-side semantics are intentionally **not daemon-served**: the
   underlying capability is a long-running stdio server in the
   operator's address space, which cannot be started in the daemon
   process. The factory body therefore returns the fixed
   `{ ok: false, reason: "daemon_required" }` discriminated arm without
   reading `link` at all. This validates that the foundation hook
   supports namespaces whose entire daemon contract is a constant
   refusal — establishing the precedent for `web` and any future
   namespace whose semantics are inherently local-only.

## Desired Outcome

`mcpServer` is the eleventh namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `McpServerClient`, `McpServerStartOptions`, and `McpServerStartResult`
  live in `src/modules/mcp-server/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports `McpServerClient`
  from the module instead of declaring the types inline. The narrow
  `no-module-imports-in-core` allowlist (today: `server/kota-client.ts`)
  already covers the import; no allowlist edit is needed.
- `src/modules/mcp-server/index.ts` adds a `daemonClient(_link)` factory
  contributing the `mcpServer` namespace. The factory returns
  `{ mcpServer }` whose `start` method ignores the `_link` parameter
  and returns the fixed `{ ok: false, reason: "daemon_required" as const }`
  arm — no `link.request*` call, no transport reach. The factory
  intentionally exercises the stub-only shape: the `link` parameter
  is named `_link` to mark it unused, mirroring the way
  `mcpServerModule.localClient: () => ...` already drops its `ctx`
  argument when no module context is required.
- `src/core/server/daemon-client.ts` no longer carries the inline
  `mcpServer: { start }` closure on the core-side stub builder, nor the
  `McpServerStartResult` import from `./kota-client.js`.
- `src/modules/mcp-server/mcp-server-operations.ts` imports
  `McpServerClient`, `McpServerStartOptions`, and `McpServerStartResult`
  from `./client.js` instead of `#core/server/kota-client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/mcp-server/daemon-client.test.ts`, mirroring the
  existing `src/modules/skill-ops/daemon-client.test.ts`) exercises the
  stub-only shape against a recording `DaemonTransport`. The test pins
  (1) the factory contributes `mcpServer`, (2) `start` returns
  `{ ok: false, reason: "daemon_required" }` regardless of the options
  passed in, (3) `start` issues **no** `request` / `requestStrict` /
  `fetchRaw` call against the transport — proven by a recording
  transport that throws on every method except the no-op
  `authHeaders`, (4) coverage success when the contribution is
  supplied and coverage failure when it is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"mcpServer"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `mcpServer` handler returning the same
  `{ ok: false, reason: "daemon_required" }` constant so tests that
  build a `DaemonControlClient` purely to exercise non-namespace
  daemon behavior continue to pass coverage.

## Constraints

- Foundation pattern only. The `mcpServer.start` daemon-side semantics
  do not change: the daemon-side handler continues to return
  `{ ok: false, reason: "daemon_required" }` for every invocation.
  No new daemon route is introduced and no existing route is touched.
- The daemon-side handler does **not** call `link.request`,
  `link.requestStrict`, `link.fetchRaw`, `link.events`, or
  `link.authHeaders`. The `_link` parameter is intentionally unused.
  This is the load-bearing new shape this migration establishes.
- Strict error handling. The daemon-side handler returns the typed
  `{ ok: false, reason: "daemon_required" }` arm directly; it does not
  throw. The local handler's existing error semantics
  (missing-API-key path, dependency loading) are unchanged and remain
  in `mcp-server-operations.ts`.
- No legacy or compatibility surface. Delete the inline closure, the
  central type declarations, and the `McpServerStartResult` import at
  the migration's edges as it completes; do not leave shims. The
  in-module import shift in `mcp-server-operations.ts` from
  `#core/server/kota-client.js` to `./client.js` is a hard cutover,
  not a parallel re-export.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `McpServerStartOptions` / `McpServerStartResult`
  declarations in `src/core/server/`. Existing assertions for the
  doctor, harnessParity, audit, retract, answer, ownerQuestions,
  modules, modulesAdmin, agents, and skills migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota mcp-server [--tools <names>]
  [--name <name>]`), daemon-up vs daemon-down branching, and error
  output all continue to behave identically. The daemon-up branch
  emits the same "Cannot start `kota mcp-server` while a daemon is
  running" error message the operator sees today.
- Output continues to flow through `src/modules/rendering`. The
  `mcp-server` module's existing `console.error`-on-refusal path is
  not part of this refactor.

## Done When

- `src/modules/mcp-server/client.ts` declares `McpServerClient`,
  `McpServerStartOptions`, and `McpServerStartResult`. The
  `KotaClient` aggregate in `src/core/server/kota-client.ts` imports
  `McpServerClient` from this module.
- `src/modules/mcp-server/index.ts` adds a `daemonClient(_link)`
  factory contributing the `mcpServer` namespace, returning
  `{ mcpServer }` whose `start` method is a stub-only handler. The
  factory body does not reach into the typed `DaemonTransport`,
  `node:http`, the bearer token, or `.kota/daemon-control.json`.
- `src/modules/mcp-server/mcp-server-operations.ts` imports
  `McpServerClient`, `McpServerStartOptions`, and `McpServerStartResult`
  from `./client.js` (not from `#core/server/kota-client.js`).
- `src/core/server/daemon-client.ts` no longer carries any
  mcpServer-specific code: no inline `mcpServer: { start }` closure on
  the core-side stub builder, and no `McpServerStartResult` import
  from `./kota-client.js`.
- `src/modules/mcp-server/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, stub return value invariant across option shapes,
  zero-transport-call invariant, coverage success when the
  contribution is supplied and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"mcpServer"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `mcpServer` handler.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace
  `McpServerStartOptions` / `McpServerStartResult` declarations in
  `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`mcpserver-daemon-up.txt` / `mcpserver-daemon-down.txt`)
  demonstrate parity for `kota mcp-server` showing the pre/post output
  is identical across modes (daemon-up: refusal message + non-zero
  exit; daemon-down: server boot up to the first stdio prompt or a
  capability-init error, depending on the operator environment —
  whichever branch the pre-migration build emits, the post-migration
  build emits the same).

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T12-32-12-690Z-explorer-t1sz87/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Twelve orthogonal preludes have already landed (eleven foundation/
pilot commits plus the skills migration):

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
- `c143c892` — modules migration extending the pattern to the
  smallest single-method namespace.
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

`mcpServer` is the natural next pilot. It is the smallest unmigrated
namespace owned by a single-purpose module that already has a
`localClient(ctx)` factory but not yet a `daemonClient(link)` factory,
and it is the first migration that exercises the **stub-only daemon-
side handler** shape — the daemon contract is intentionally a fixed
constant refusal (`{ ok: false, reason: "daemon_required" }`) because
the underlying capability is a long-running stdio server that cannot
be started in the daemon process. Validating the foundation hook
supports a `daemonClient(_link)` factory whose handler ignores `link`
establishes the precedent for `web` (the only other stub-only
namespace today) and for any future namespace whose semantics are
inherently local-only. The migration is needed under every chunking
answer the owner can pick (a/b/c/d/unblock): the mcpServer namespace
migrates exactly once regardless of whether the parent lands in one
cohesive run or fans out across follow-ups, so this task does not
commit the owner to any specific chunking answer; it shrinks the
parent task's scope by one full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type moves out of `src/core/server/`, the
  new `daemonClient(_link)` factory on `mcpServerModule`, the in-module
  import shift in `mcp-server-operations.ts`, the removed inline
  closure and `McpServerStartResult` import from
  `src/core/server/daemon-client.ts`, and the new daemon-side unit
  test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~22-line and ~5-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`mcpserver-daemon-up.txt` / `mcpserver-daemon-down.txt`)
  exercising `kota mcp-server` with identical output across modes
  (daemon-up shows the refusal message; daemon-down shows whichever
  branch the pre-migration build emits).
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced
  `McpServerStartOptions` / `McpServerStartResult` declaration in
  `src/core/server/`.
