---
id: task-add-kotamodule-daemonclientlink-factory-hook-plus-
title: Add KotaModule daemonClient(link) factory hook plus DaemonControlClient handler-assembly for namespace migrations
status: ready
priority: p1
area: architecture
summary: Add a daemonClient(link) factory hook on KotaModule parallel to localClient(ctx) plus a DaemonClientHandlers assembly path on DaemonControlClient, so per-namespace migrations from src/core/server/daemon-client.ts become mechanical moves into the owning module — orthogonal to the parent KotaClient namespace chunking decision and required for every variant the owner can pick.
created_at: 2026-05-03T05:37:56.551Z
updated_at: 2026-05-03T05:37:56.551Z
---

## Problem

`src/core/server/daemon-client.ts` is 1966 lines today. The orthogonal
prelude `task-decouple-non-namespace-daemon-transport-methods-fr` (done
2026-05-03) extracted the typed `DaemonTransport` link object into
`src/core/server/daemon-transport.ts` and removed direct
`DaemonControlClient` imports of non-namespace methods from nine
modules. What remains in `daemon-client.ts` is the per-namespace wire
code: 27 `KotaClient` namespace fields (`workflow`, `approvals`,
`secrets`, `tasks`, `memory`, `ownerQuestions`, `history`, `knowledge`,
`sessions`, `modules`, `agents`, `skills`, `harnessParity`, `webhook`,
`voice`, `web`, `mcpServer`, `audit`, `config`, `modulesAdmin`,
`daemonOps`, `doctor`, `evalHarness`, `recall`, `answer`, `capture`,
`retract`) constructed inline in one ~1700-line constructor.

The asymmetry against the local side is sharp. `LocalKotaClient`
(`src/core/server/local-kota-client.ts`, 98 lines) is composed from a
`Partial<LocalClientHandlers>` map populated by each owning module's
`localClient(ctx)` factory on `KotaModule`. The loader
(`src/core/modules/module-loader.ts:230-247`) already validates that
every declared namespace has a registered local handler. The daemon
side has no parallel mechanism — every namespace is hardcoded in one
core file, so a per-namespace migration today still requires editing
`src/core/server/daemon-client.ts` to remove the inline closure.

This is the foundation step explicitly named in the parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (still
blocked on owner-decision `kotaclient-namespace-distribution-chunking`,
unanswered since 2026-04-26): introduce a `daemonClient(link)` factory
hook on `KotaModule` parallel to `localClient(ctx)`, with the loader
and selector validating that every declared namespace has both a local
and a daemon handler. The hook itself does not depend on which
chunking answer the owner picks — every variant (a/b/c/d/unblock)
needs the registration mechanism in tree before per-namespace shapes
can move out. Pulling this work forward shrinks the parent task's
scope to a mechanical "move each namespace's closure factory into its
owning module's `daemonClient(link)`" once the owner answers the
chunking question.

## Desired Outcome

A typed `daemonClient(link)` factory hook exists on `KotaModule`
symmetric to `localClient(ctx)`. The loader assembles a
`Partial<DaemonClientHandlers>` map across modules during load. The
selector and `DaemonControlClient` validate that every namespace in
`KOTA_CLIENT_NAMESPACES` has a registered daemon handler — missing
handlers are a load-time error with no silent fallback. A guard test
rejects new per-namespace request/response type declarations under
`src/core/server/`.

No namespace shapes are moved in this task. `daemon-client.ts` may
still hold all 27 inline closures at completion; what changes is
*how* `DaemonControlClient` exposes them — through the same
contributed-handler assembly path the local side already uses, with
the inline closures rewritten as a single core-side stub registration
that future per-namespace migrations carve away one at a time.

After the refactor:

- `KotaModule` carries `daemonClient?: (link: DaemonTransport) =>
  Partial<DaemonClientHandlers>` parallel to `localClient`.
- `DaemonControlClient` constructor accepts an assembled
  `DaemonClientHandlers` map (initially populated by one core-side
  stub holding the 27 existing closures, plus any module that wants to
  migrate immediately).
- The module loader invokes both `localClient(ctx)` and
  `daemonClient(link)` factories during load. The selector validates
  full coverage on both sides.
- A guard test enforces that new per-namespace request/response types
  (e.g. `*Filter`, `*Result`, `*Options`) cannot be declared under
  `src/core/server/`. The existing `kota-client-guard.test.ts` is
  updated, not duplicated.

## Constraints

- Do not move any per-namespace closure factory in this task. The
  scope boundary matches the parent task's foundation phase: introduce
  the hook and the assembly mechanism, but every closure stays in
  whichever file holds it today.
- Do not introduce a second public client surface. The hook is
  symmetric with `localClient(ctx)` — same `KotaModule` shape, same
  loader path, same selector validation.
- Preserve the daemon HTTP wire shape exactly. This is an internal
  refactor; CLI behavior, daemon-up/daemon-down branches, and JSON /
  pipe-mode output do not change.
- The link object handed to `daemonClient(link)` is the typed
  `DaemonTransport` from `src/core/server/daemon-transport.ts` (already
  in tree). Do not introduce a parallel link surface.
- No legacy or compatibility surface. Once the hook lands, the
  inline-closure path on `DaemonControlClient` is removed in the same
  change — replaced by a core-side stub registration for the closures
  that have not yet migrated to their owning module.
- The `bootstrap` exemption (`init`, `registry`, `completion`,
  `daemon-ops install`) and the existing direct-`.kota/`-read guard
  remain untouched.
- Do not invent a parallel module-contribution path. The guard test
  enforces this — new per-namespace types under `src/core/server/`
  fail it.
- Output continues to flow through `src/modules/rendering`. The
  rendering layer is not part of this refactor.

## Done When

- `KotaModule.daemonClient?: (link: DaemonTransport) =>
  Partial<DaemonClientHandlers>` is declared in
  `src/core/modules/module-types.ts` and documented next to
  `localClient`.
- `DaemonClientHandlers` (mapping each namespace to its daemon-side
  implementation type) lives in `src/core/server/kota-client.ts`
  symmetric with `LocalClientHandlers`.
- The module loader invokes `daemonClient(link)` for each module that
  declares it, accumulates a `Partial<DaemonClientHandlers>` map, and
  exposes it through a method symmetric with the existing
  `localClientHandlers` accessor.
- `DaemonControlClient` is reshaped to consume an assembled
  `DaemonClientHandlers` map in its constructor instead of building
  every namespace inline. A core-side stub registration holds the 27
  closures that have not yet migrated to their owning module, so the
  external behavior is unchanged.
- The selector validates that every declared namespace has both a
  registered local handler and a registered daemon handler. Missing
  handlers fail load with an error naming the missing namespace; no
  silent fallback.
- A guard test (extension of `kota-client-guard.test.ts` or a new
  sibling) rejects new per-namespace request/response type
  declarations (matching `*Filter`, `*Result`, `*Options`,
  `*Response`, `*ListEntry`) under `src/core/server/` outside the
  shared aggregate types.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Daemon-up and daemon-down CLI transcripts captured under the run
  directory show parity for at least one mutation and one read in two
  representative namespaces (one heavy, e.g. `workflow` or `tasks`;
  one light, e.g. `doctor` or `config`).
- `src/core/server/daemon-client.ts` line count is recorded before
  and after; the file may stay near its current size but is now
  populated through the contributed-handler assembly path so future
  per-namespace migrations are mechanical moves out of the core stub
  rather than constructor edits.

## Source / Intent

Extracted from
`task-distribute-kotaclient-namespace-types-and-daemon-s` (parent
task in `data/tasks/blocked/`, blocked on owner-decision
`kotaclient-namespace-distribution-chunking` since 2026-04-26). The
parent task's `## Decomposition Proposal` foundation phase explicitly
names this hook as the cross-cutting infrastructure that lands before
any namespace shape moves. The orthogonal prelude
`task-decouple-non-namespace-daemon-transport-methods-fr` already
landed the typed `DaemonTransport` link object (commit `a0a5e3e2`,
2026-05-03); this task is the next orthogonal extraction from the
same foundation, equally independent of the chunking decision.

Strategic-ready coverage was the immediate trigger: with only the
mobile conformance-decoder p3 client task in `ready/` after the prior
prelude landed, and every strategic blocked task gated on
owner-decision, operator-capture, or capability-installed
preconditions, the explorer needed an actionable strategic next step
that did not invent surface-completion fan-out work. The hook is
adjacent, mechanical, and shrinks the parent task's scope under any
chunking answer the owner eventually picks.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient daemon-side wire code — lives
in the owning module, with `src/core/server/` reduced to the typed
`KotaClient` aggregate, the namespace registration mechanism, and a
small typed transport primitive. This task is the second orthogonal
prelude to
`task-distribute-kotaclient-namespace-types-and-daemon-s`, after
`task-decouple-non-namespace-daemon-transport-methods-fr`.

## Acceptance Evidence

- Diff covering the new `daemonClient(link)` hook on `KotaModule`,
  the `DaemonClientHandlers` mapping, the loader assembly path, the
  selector validation, the `DaemonControlClient` reshape onto the
  assembled map, the core-side stub registration for unmigrated
  closures, and the new guard test.
- Line-count snapshot of `src/core/server/daemon-client.ts` before
  and after; the file may stay near its current size but its
  construction shape changes from inline closures to assembled
  handlers.
- Daemon-up CLI transcript under the run directory exercising one
  read and one mutation against two representative namespaces (one
  heavy, one light), demonstrating identical wire behavior.
- Test output showing the new guard test passing on the current
  tree and failing on a deliberately-introduced new per-namespace
  type declared under `src/core/server/` outside the shared
  aggregate types.
- Test output showing the selector failing load when a deliberately-
  removed daemon handler leaves a namespace uncovered, mirroring the
  existing local-handler missing-coverage error path.
