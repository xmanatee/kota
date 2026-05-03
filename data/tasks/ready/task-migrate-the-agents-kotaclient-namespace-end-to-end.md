---
id: task-migrate-the-agents-kotaclient-namespace-end-to-end
title: Migrate the agents KotaClient namespace end-to-end through the daemonClient(link) factory hook
status: ready
priority: p1
area: architecture
summary: Move AgentsClient interface, AgentSummary, AgentsListResult, and AgentInspectResult from src/core/server/kota-client.ts into src/modules/agent-ops/client.ts; add a daemonClient(link) factory on agentsModule contributing the agents namespace backed by the typed DaemonTransport with two GETs; remove listAgentsHttp, inspectAgentHttp, and the inline agents closure from src/core/server/daemon-client.ts.
created_at: 2026-05-03T11:20:20.671Z
updated_at: 2026-05-03T11:20:20.671Z
---

## Problem

The doctor pilot (commit `9f07ee87`, 2026-05-03), the harnessParity
follow-on (commit `927dca24`, 2026-05-03), the audit migration (commit
`b6278cf1`, 2026-05-03), the retract migration (commit `8c212f0c`,
2026-05-03), the answer migration (commit `eb392cd1`, 2026-05-03), the
ownerQuestions migration (commit `68b74850`, 2026-05-03), the modules
migration (commit `c143c892`, 2026-05-03), and the modulesAdmin migration
(commit `03485329`, 2026-05-03) have validated the
`daemonClient(link)` foundation pattern by moving eight namespaces out of
`src/core/server/kota-client.ts` and `src/core/server/daemon-client.ts`
into their owning modules. 19 namespaces still have their TypeScript
shape and daemon-side wire code centralized in those two files
(`kota-client.ts` is 1531 lines, `daemon-client.ts` is 1959 lines, both
still well over the 300-line guideline).

The next-cleanest namespace that meaningfully extends the pattern is
`agents`:

- 2 read-only methods (`list()`, `inspect(name)`) — owned by the
  `agent-ops` module which already exposes a `localClient(ctx)` factory
  but not yet a `daemonClient(link)` factory. Adding the factory
  contributes the first read-only namespace migration through the
  foundation hook (every prior pilot has at least one mutation method
  — doctor.fix, harnessParity.run, retract.retract, answer.answer,
  ownerQuestions.answer/dismiss, modules.list+modulesAdmin.reload).
- ~32 lines of namespace-owned types in `kota-client.ts`:
  - `AgentSummary` (lines 999-1009, ~11 lines): the per-agent summary
    (name, source, role, model, optional effort, promptPath, writeScope,
    optional skills, optional tools).
  - `AgentsListResult` (lines 1011-1013, 3 lines): the `{ agents:
    AgentSummary[] }` envelope.
  - `AgentInspectResult` (lines 1015-1017, 3 lines): the discriminated
    `{ found: true; agent } | { found: false }` envelope.
  - `AgentsClient` interface (lines 1028-1031, 4 lines).
  - The interface doc comment block (lines 1019-1027, ~9 lines) moves
    alongside the interface into the module-local `client.ts`.
- ~30 lines of wire code in `daemon-client.ts`:
  - `listAgentsHttp` (lines 483-494, 12 lines): GET `/agents` with
    bearer headers; non-2xx throws with the body's error message,
    success returns the JSON `AgentsListResult` verbatim.
  - `inspectAgentHttp` (lines 496-510, 15 lines): GET
    `/agents/{encodeURIComponent(name)}` with bearer headers; 404 →
    `{ found: false }`, non-2xx throws with the body's error message,
    success returns the JSON `AgentInspectResult` verbatim.
  - The inline `agents: { list, inspect }` closure on the central
    handler builder (lines 1545-1547, 3 lines).
- 2 imports in `daemon-client.ts` (`AgentInspectResult`,
  `AgentsListResult` from `./kota-client.js`) that go away with the
  wire functions.

The migration extends the foundation pattern in one axis the prior
eight pilots did not exercise:

1. **First pure read-only namespace migration through the foundation
   hook.** Every prior pilot's namespace contained at least one mutation
   method (doctor: `fix`; harnessParity: `run`; audit was read-only but
   carried a query-string body; retract: `retract`; answer:
   `answer`/`log` mix; ownerQuestions: `answer`/`dismiss`; modules:
   `list` only but paired with modulesAdmin's mutations from the same
   module). `agents` is the first namespace whose entire surface is two
   GET methods with no mutation, no query body, and no JSON body —
   validating that `link.requestStrict<T>` collapses cleanly for the
   "two simple GETs" shape that several remaining namespaces (e.g.
   `skills`, `daemonOps` reads, `evalHarness.list`) also use.

`AgentSummary`, `AgentsListResult`, and `AgentInspectResult` are also
imported by:

- `src/modules/agent-ops/agent-ops-operations.ts` (the local-side
  `listAgents` / `inspectAgent` implementations): imports
  `AgentInspectResult`, `AgentSummary`, `AgentsListResult` from
  `#core/server/kota-client.js` today.
- `src/modules/agent-ops/index.ts`: imports `AgentSummary`,
  `AgentsClient` from `#core/server/kota-client.js` today.

Both shifts are in-module imports from `./client.js` after the
migration. Neither file gains a `#modules/*` cross-module import; both
already live inside `agent-ops/`.

## Desired Outcome

`agents` is the ninth namespace to leave `src/core/server/`
end-to-end through the `daemonClient(link)` foundation hook:

- `AgentsClient`, `AgentSummary`, `AgentsListResult`, and
  `AgentInspectResult` live in
  `src/modules/agent-ops/client.ts`. The aggregate `KotaClient`
  interface in `src/core/server/kota-client.ts` imports
  `AgentsClient` from the module instead of declaring the types
  inline. The narrow `no-module-imports-in-core` allowlist (today:
  `server/kota-client.ts`) already covers the import; no allowlist
  edit is needed.
- `src/modules/agent-ops/index.ts` adds a `daemonClient(link)`
  factory contributing the `agents` namespace. The factory returns
  `{ agents }` backed by `link.requestStrict<T>` calls:
  - `list()` → `link.requestStrict<AgentsListResult>("GET", "/agents")`.
  - `inspect(name)` →
    `link.requestStrict<AgentInspectResult>("GET", "/agents/{encodeURIComponent(name)}")`.
    The factory does **not** preserve today's special-cased
    `404 → { found: false }` translation as a divergent code path —
    instead it issues the strict GET and decodes the canonical
    `AgentInspectResult` discriminated union the daemon already emits.
    Because the daemon route is the source of truth for the
    `{ found: true | false }` envelope, the wire shape is uniform and
    the factory body collapses to one `link.requestStrict<T>` call.
    The existing daemon route at
    `src/modules/agent-ops/routes.ts:handleInspect` currently emits
    `404 { error }` on the not-found case; this task amends that
    handler to emit `200 { found: false }` to match the rest of the
    migrated namespaces' strict-transport posture and remove the
    `404 → typed result` special-case.
- `src/core/server/daemon-client.ts` no longer carries
  `listAgentsHttp`, `inspectAgentHttp`, the inline
  `agents: { list, inspect }` closure on the core-side stub
  builder, or the `AgentInspectResult` / `AgentsListResult` imports
  from `./kota-client.js`.
- `src/modules/agent-ops/agent-ops-operations.ts` imports
  `AgentInspectResult`, `AgentSummary`, `AgentsListResult` from
  `./client.js` instead of `#core/server/kota-client.js`.
- `src/modules/agent-ops/index.ts` imports `AgentSummary`,
  `AgentsClient` from `./client.js` instead of
  `#core/server/kota-client.js`.
- A new daemon-side factory unit test alongside the module
  (`src/modules/agent-ops/daemon-client.test.ts`, mirroring the
  existing `src/modules/module-manager/daemon-client.test.ts`)
  exercises the wire shape against a mock `DaemonTransport`. The test
  pins (1) the factory contributes `agents`, (2) `list` routes through
  `requestStrict<T>` with `GET /agents` and no body, (3) a successful
  `{ agents: AgentSummary[] }` response decodes verbatim, (4) `inspect`
  routes through `requestStrict<T>` with `GET /agents/{name}` (URL-
  encoded) and no body, (5) a `{ found: true; agent }` response
  decodes verbatim, (6) a `{ found: false }` response decodes
  verbatim, (7) `requestStrict<T>` failures on either method propagate
  rather than being silently swallowed, (8) coverage success when the
  contribution is supplied and coverage failure when it is removed.
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends with `"agents"`, and `buildMigratedNamespaceTestStubs()`
  in `src/core/server/daemon-client-test-stubs.ts` extends with a
  stub `agents` handler returning `{ agents: [] }` for `list` and
  `{ found: false }` for `inspect` so tests that build a
  `DaemonControlClient` purely to exercise non-namespace daemon
  behavior continue to pass coverage.

## Constraints

- Foundation pattern only. The one acceptable shape adjustment is
  converting `/agents/:name`'s current `404 { error }` not-found
  branch to `200 { found: false }` to align with the strict-transport
  posture every other migrated namespace uses. No other route, wire
  shape, or response-body change.
- The daemon-side handler uses `link.requestStrict<T>` through the
  typed `DaemonTransport`. It does not reach into `node:http`, the
  bearer token, or `.kota/daemon-control.json`.
- Strict error handling. Today's `listAgentsHttp` and
  `inspectAgentHttp` already throw on non-2xx; the migration
  preserves that posture through `requestStrict<T>`.
- No legacy or compatibility surface. Delete `listAgentsHttp`,
  `inspectAgentHttp`, the inline closure, the central type
  declarations, and the `AgentInspectResult` / `AgentsListResult`
  imports at the migration's edges as it completes; do not leave
  shims. The in-module import shifts from `#core/server/kota-client.js`
  to `./client.js` are hard cutovers, not parallel re-exports.
- The existing namespace-registration guard at
  `src/core/server/kota-client-namespace-types-guard.test.ts`
  continues to pass and rejects deliberately re-introduced
  per-namespace `AgentSummary` / `AgentsListResult` /
  `AgentInspectResult` declarations in `src/core/server/`. Existing
  assertions for the doctor, harnessParity, audit, retract, answer,
  ownerQuestions, modules, and modulesAdmin migrations stay green.
- The existing `no-module-imports-in-core` guard already allows
  `server/kota-client.ts` to import from `#modules/*`; no allowlist
  edit is needed for this migration.
- No protocol change. CLI behavior (`kota agent list`,
  `kota agent inspect <name>`), daemon-up vs daemon-down branching,
  and `--json` output all continue to behave identically modulo the
  optional 404→200 alignment above (which the CLI propagates through
  the same discriminated `{ found: false }` branch either way).
- Output continues to flow through `src/modules/rendering`. The
  agent-ops module's existing CLI rendering (`buildAgentListLines`,
  `buildAgentInspectEntries`) is not part of this refactor.

## Done When

- `src/modules/agent-ops/client.ts` declares `AgentsClient`,
  `AgentSummary`, `AgentsListResult`, and `AgentInspectResult`. The
  `KotaClient` aggregate in `src/core/server/kota-client.ts` imports
  `AgentsClient` from this module.
- `src/modules/agent-ops/index.ts` adds a `daemonClient(link)`
  factory contributing the `agents` namespace, returning
  `{ agents }`. Both methods' factory bodies use the typed
  `DaemonTransport`; neither reaches into `node:http`, the bearer
  token, or `.kota/daemon-control.json`.
- `src/modules/agent-ops/index.ts` and
  `src/modules/agent-ops/agent-ops-operations.ts` import
  `AgentInspectResult`, `AgentSummary`, `AgentsListResult`,
  `AgentsClient` from `./client.js` (not from
  `#core/server/kota-client.js`).
- `src/modules/agent-ops/routes.ts:handleInspect` returns
  `200 { found: false }` on the not-found case (replacing today's
  `404 { error }`), aligning with the strict-transport posture every
  other migrated namespace uses.
- `src/core/server/daemon-client.ts` no longer carries any
  agents-specific code: no `listAgentsHttp`, no `inspectAgentHttp`,
  no inline `agents: { list, inspect }` closure on the core-side
  stub builder, and no `AgentInspectResult` / `AgentsListResult`
  imports from `./kota-client.js`.
- `src/modules/agent-ops/daemon-client.test.ts` exists and pins the
  invariants enumerated in `## Desired Outcome` above (factory
  presence, two GET wire shapes, decoded success/not-found shapes,
  transport-error propagation, coverage success when contribution is
  supplied and coverage failure when it is removed).
- `STUB_OMITTED_NAMESPACES` in `src/core/server/daemon-client.test.ts`
  extends to include `"agents"`, and
  `buildMigratedNamespaceTestStubs()` in
  `src/core/server/daemon-client-test-stubs.ts` extends with a stub
  `agents` handler.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- `kota-client-namespace-types-guard.test.ts` continues to pass and
  rejects deliberately re-introduced per-namespace `AgentSummary` /
  `AgentsListResult` / `AgentInspectResult` declarations in
  `src/core/server/`.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`agents-daemon-up.txt` / `agents-daemon-down.txt`) demonstrate
  parity for `kota agent list` and `kota agent inspect <name>`
  showing the pre/post output is identical across modes.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-05-03T11-16-56-146Z-explorer-qe4ewl/` as the next
orthogonal extraction from the blocked parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (owner-
decision slot `kotaclient-namespace-distribution-chunking` open since
2026-04-26).

Ten orthogonal preludes have already landed:

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
  smallest single-method namespace.
- `03485329` — modulesAdmin migration extending the pattern to the
  first multi-namespace contribution from a single module's
  `daemonClient(link)` factory and the first cross-namespace
  dependency consumption.

`agents` is the natural next pilot. It is the smallest unmigrated
namespace owned by a single-purpose module that already has a
`localClient(ctx)` factory but not yet a `daemonClient(link)` factory,
and it is the first migration that exercises the "pure read-only
namespace" shape — two GETs, no mutation, no query body, no JSON body
— that several remaining namespaces (`skills`, `evalHarness.list`,
`daemonOps` reads) also use. Validating the pattern collapses cleanly
for that shape establishes the precedent for the read-only follow-ups.
The migration is needed under every chunking answer the owner can
pick (a/b/c/d/unblock): the agents namespace migrates exactly once
regardless of whether the parent lands in one cohesive run or fans
out across follow-ups, so this task does not commit the owner to any
specific chunking answer; it shrinks the parent task's scope by one
full namespace whichever answer wins.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the
owning module, with `src/core/` reduced to genuine cross-cutting
protocols and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type moves out of `src/core/server/`, the
  new `daemonClient` factory on `agentsModule`, the in-module import
  shifts in `index.ts` and `agent-ops-operations.ts`, the
  `routes.ts` 404→200 alignment for `handleInspect`, the removed
  `listAgentsHttp` / `inspectAgentHttp` / inline closure, and the
  new daemon-side unit test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, showing the
  expected ~32-line and ~30-line shrinkage respectively.
- Daemon-up and daemon-down CLI transcripts under the run directory
  (`agents-daemon-up.txt` / `agents-daemon-down.txt`) exercising
  `kota agent list` and `kota agent inspect <name>` with identical
  output across modes.
- Test output showing the existing
  `kota-client-namespace-types-guard.test.ts` passes on the current
  tree and fails on a deliberately re-introduced `AgentSummary` /
  `AgentsListResult` / `AgentInspectResult` declaration in
  `src/core/server/`.
