---
id: task-migrate-the-doctor-kotaclient-namespace-end-to-end
title: Migrate the doctor KotaClient namespace end-to-end through the new daemonClient(link) factory hook (foundation pilot)
status: ready
priority: p1
area: architecture
summary: Migrate the doctor KotaClient namespace end-to-end through the new daemonClient(link) factory hook: move DoctorClient and its request/response types out of src/core/server/kota-client.ts into the doctor module, register the doctor module's daemonClient(link) factory, and remove doctorRunHttp/doctorFixHttp plus the doctor closure from src/core/server/daemon-client.ts so the foundation pattern is validated end-to-end on the smallest namespace before the per-namespace fan-out lands.
created_at: 2026-05-03T06:20:34.376Z
updated_at: 2026-05-03T06:20:34.376Z
---

## Problem

The KotaClient namespace foundation phase is now in tree:

- The `daemonClient(link)` factory hook on `KotaModule` parallel to
  `localClient(ctx)` landed 2026-05-03 in commit `203c76a6` along with
  the `DaemonClientHandlers` assembly path on `DaemonControlClient` and
  the `kota-client-namespace-types-guard.test.ts` guard that rejects
  per-namespace request/response types under `src/core/server/`.
- The typed `DaemonTransport` link surface plus the non-namespace
  transport-method decoupling landed earlier in commit `a0a5e3e2`.

What is missing is a single end-to-end pilot that exercises the new
hook on a real namespace. Today every one of the 27 `KotaClient`
namespaces (`workflow`, `approvals`, `secrets`, `tasks`, `memory`,
`ownerQuestions`, `history`, `knowledge`, `sessions`, `modules`,
`agents`, `skills`, `harnessParity`, `webhook`, `voice`, `web`,
`mcpServer`, `audit`, `config`, `modulesAdmin`, `daemonOps`, `doctor`,
`evalHarness`, `recall`, `answer`, `capture`, `retract`) is still
implemented through the core-side stub `buildCoreStubDaemonClientHandlers`
in `src/core/server/daemon-client.ts:1717`, which currently sits at
2349 lines. No module yet contributes a `daemonClient(link)` factory,
so the foundation hook is exercised only by `daemon-client.test.ts`,
not by a real per-module migration.

The doctor namespace is the smallest, most contained surface to
validate the pattern end-to-end:

- `DoctorClient` exposes only two operations (`run`, `fix`) with simple
  options/result shapes (`src/core/server/kota-client.ts:1801-1826`).
- The wire methods are two short HTTP closures
  (`doctorRunHttp` / `doctorFixHttp` at
  `src/core/server/daemon-client.ts:495-524`).
- The doctor module already owns `localClient(ctx)`
  (`src/modules/doctor/index.ts:112-125`) and the daemon-side HTTP
  routes (`src/modules/doctor/doctor-control-routes.ts`). The only
  asymmetry left is that the module does not yet contribute
  `daemonClient(link)` and the doctor types still live in core.

Migrating doctor through the foundation hook is the canonical pilot
named in the parent task's `## Decomposition Proposal` (recommended:
`doctor` or `config`, smallest namespaces, fewest cross-module
dependencies). Picking it up now does not commit the owner to any
specific chunking answer for the parent task — under any of the
proposed answers (a/b/c/d/unblock) the doctor namespace still has to
migrate into its owning module exactly once. This shrinks the parent
task's scope by one full namespace whichever answer the owner picks.

## Desired Outcome

The doctor namespace is fully owned by the doctor module:

- Its TypeScript interface (`DoctorClient`) and its request/response
  types (`DoctorRunOptions`, `DoctorRunResult`, `DoctorFixResult`,
  `DoctorCheckResult`, `DoctorRepairResult`) live alongside the rest
  of the doctor module under `src/modules/doctor/` rather than in
  `src/core/server/kota-client.ts`. The `KotaClient` aggregate imports
  `DoctorClient` from the doctor module to compose it back into the
  shared contract.
- The doctor module exposes a `daemonClient(link)` factory parallel to
  its existing `localClient(ctx)` factory. The factory consumes the
  typed `DaemonTransport` link object and returns a
  `Partial<DaemonClientHandlers>` map containing the doctor namespace
  implementation.
- `src/core/server/daemon-client.ts` no longer contains
  `doctorRunHttp`, `doctorFixHttp`, the `doctor` closure inside
  `buildCoreStubDaemonClientHandlers`, or the `DoctorRunResult` /
  `DoctorFixResult` import line. The selector validates that the
  doctor namespace still has a registered daemon handler — through
  the doctor module's contribution — and rejects any partial wiring
  with a load-time error.
- Both the `pnpm typecheck`/`lint`/`test` suite and a daemon-up CLI
  transcript demonstrate that the doctor namespace's wire shape is
  unchanged: `kota doctor` and `kota doctor --fix` produce identical
  pass/warn/fail rendering before and after the migration.

## Constraints

- Migrate only the doctor namespace in this task. Do not touch the
  remaining 26 namespaces; they remain in
  `buildCoreStubDaemonClientHandlers` until their own follow-ups land.
- One mechanism. The doctor module's `daemonClient(link)` factory is
  the single registration path. Do not introduce a parallel client
  surface or a doctor-specific bootstrap.
- Preserve the daemon HTTP wire shape exactly. This is an internal
  refactor; CLI behavior, daemon-up/daemon-down branches, and JSON /
  pipe-mode output do not change.
- Do not weaken the namespace-types guard. After this task lands the
  guard's allowlist must not contain any doctor-namespace type; if a
  doctor type is genuinely cross-cutting infrastructure (it is not),
  document the reason in code, not in the allowlist.
- Do not duplicate the doctor types. There is one canonical home in
  `src/modules/doctor/` (e.g. `src/modules/doctor/client.ts` next to
  `index.ts`). The aggregate `KotaClient` interface in
  `src/core/server/kota-client.ts` imports the type from the module
  path; it does not redeclare it.
- No legacy or compatibility surface. Delete the old core-side
  declarations in the same change; no deprecation re-export shim.
- The `bootstrap` exemption (`init`, `registry`, `completion`,
  `daemon-ops install`) and the existing direct-`.kota/`-read guard
  remain untouched.
- Output continues to flow through `src/modules/rendering`. The
  rendering layer is not part of this refactor.

## Done When

- `DoctorClient`, `DoctorRunOptions`, `DoctorRunResult`,
  `DoctorFixResult`, `DoctorCheckResult`, and `DoctorRepairResult`
  live under `src/modules/doctor/` (e.g. `client.ts`). They are
  removed from `src/core/server/kota-client.ts`; that file imports
  `DoctorClient` from the module path to compose the `KotaClient`
  aggregate.
- The doctor module exports a `daemonClient(link: DaemonTransport)`
  factory in `src/modules/doctor/index.ts` returning
  `{ doctor: { run, fix } }`. The implementation calls the doctor
  HTTP routes through the typed transport (`request<T>` /
  `requestStrict<T>`); it does not import `DaemonControlClient`,
  `fetchWithTimeout`, the bearer token, or `node:http` directly.
- `src/core/server/daemon-client.ts` no longer declares
  `doctorRunHttp` or `doctorFixHttp`, no longer imports the doctor
  result types from `kota-client.ts`, and no longer constructs a
  `doctor:` closure inside `buildCoreStubDaemonClientHandlers`. The
  file's line count drops by the doctor namespace's share.
- The selector still validates daemon-handler coverage. A focused
  test removes the doctor module's `daemonClient(link)` factory and
  asserts the load fails with a clear "doctor namespace has no
  registered daemon handler" error.
- The namespace-types guard test stays green without the doctor types
  appearing on its allowlist (the guard skips `kota-client.ts`, but
  the doctor types must not be re-introduced anywhere else under
  `src/core/server/`).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- A daemon-up CLI transcript captured under the run directory shows
  `kota doctor` and `kota doctor --fix` rendering identical pass/
  warn/fail / repair output to a pre-migration baseline transcript.

## Source / Intent

Extracted from the parent task
`task-distribute-kotaclient-namespace-types-and-daemon-s` (still
blocked on owner-decision `kotaclient-namespace-distribution-chunking`,
unanswered since 2026-04-26). The parent task's `## Decomposition
Proposal` explicitly names the doctor or config namespace as the
recommended pilot to validate the foundation pattern end-to-end before
the remaining 22 follow-ups fan out. With foundation complete in tree
(commits `a0a5e3e2` 2026-05-03 and `203c76a6` 2026-05-03), the pilot
migration is the next orthogonal extraction: it does not depend on
which chunking answer the owner picks because every variant needs the
doctor namespace to migrate exactly once. Doctor was chosen over
config because doctor exposes 2 methods with no cross-module state
while config exposes 5 with schema-path resolution shared with the
init/bootstrap exemption.

Strategic-ready coverage was the immediate trigger: with only the
mobile conformance-decoder p3 client task in `ready/` after the prior
prelude landed, and every strategic blocked task gated on
owner-decision, operator-capture, or capability-installed
preconditions, the explorer needed an actionable strategic next step
that did not invent surface-completion fan-out work. The pilot is
adjacent, mechanical, and shrinks the parent task's scope under any
chunking answer the owner eventually picks.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient daemon-side wire code — lives
in the owning module, with `src/core/server/` reduced to the typed
`KotaClient` aggregate, the namespace registration mechanism, and a
small typed transport primitive. This task is the third orthogonal
prelude to `task-distribute-kotaclient-namespace-types-and-daemon-s`,
after `task-decouple-non-namespace-daemon-transport-methods-fr`
(commit `a0a5e3e2`) and
`task-add-kotamodule-daemonclientlink-factory-hook-plus-`
(commit `203c76a6`). It is the first per-namespace migration to land
on the new foundation hook.

## Acceptance Evidence

- Diff covering: the new doctor-module client file (or wherever
  doctor types live), the doctor module's new `daemonClient(link)`
  factory in `src/modules/doctor/index.ts`, the removal of
  `doctorRunHttp` / `doctorFixHttp` / the `doctor:` closure from
  `src/core/server/daemon-client.ts`, the removal of doctor types
  from `src/core/server/kota-client.ts`, and the `KotaClient`
  aggregate's new import line.
- Line-count snapshot of `src/core/server/daemon-client.ts` and
  `src/core/server/kota-client.ts` before and after, showing the
  doctor namespace's share has moved out.
- Daemon-up CLI transcript under the run directory exercising
  `kota doctor`, `kota doctor --json`, and `kota doctor --fix`,
  showing identical rendering to a pre-migration baseline transcript
  also captured under the run directory.
- Test output showing the new selector failure-mode test passing on
  the current tree (asserts a clear error when the doctor module's
  `daemonClient(link)` factory is removed) and the existing
  namespace-types guard test continuing to pass without doctor types
  on the allowlist.
