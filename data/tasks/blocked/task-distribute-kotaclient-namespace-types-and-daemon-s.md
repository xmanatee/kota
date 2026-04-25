---
id: task-distribute-kotaclient-namespace-types-and-daemon-s
title: Distribute KotaClient namespace types and daemon-side wire code into the owning modules
status: blocked
priority: p1
area: architecture
summary: Move KotaClient namespace type declarations and DaemonControlClient wire code from src/core/server/kota-client.ts and src/core/server/daemon-client.ts into the owning modules so the central files become thin protocol surfaces, mirroring the existing module-owned localClient(ctx) factory.
created_at: 2026-04-25T23:45:34.278Z
updated_at: 2026-04-25T23:52:25.348Z
---

## Unblock Precondition

```
kind: owner-decision
slot: kotaclient-namespace-distribution-chunking
question: Should this 3500-line cross-23-namespace refactor land in (a) one cohesive builder run, (b) a foundation task plus 23 per-namespace migration sub-tasks, (c) 2-3 batched sub-tasks (foundation + first half + second half), or (d) foundation plus a pilot namespace plus follow-up migrations?
context: kota-client.ts is 1477 lines and daemon-client.ts is 1893 lines; DaemonControlClient has 104 references across the repo and ~20 of its public non-namespace transport methods (getDaemonStatus, pause, events, voiceTranscribe, registerSession, queryEvents, ...) are consumed directly by route handlers in webhook, workflow-ops, module-manager, commands, push-notification, and voice modules. Driving daemon-client.ts under the 300-line guideline therefore also requires refactoring those route handlers, not just relocating namespace closures. The task's "Done When" criteria are all-or-nothing (both files <300 lines, every namespace migrated, full CLI parity transcripts, guard test); a single autonomous builder run is unlikely to land that without leaving partial state. Owner question 41f97b38 asked on 2026-04-26.
proposed_answers: attempt_full_in_one_run, decompose_into_foundation_plus_per_namespace_subtasks, decompose_into_2_or_3_batched_subtasks, decompose_into_foundation_plus_pilot_namespace_then_followups, unblock
```

## Problem

`src/core/server/kota-client.ts` is 1477 lines and `src/core/server/
daemon-client.ts` is 1893 lines. Both files grow linearly every time a
module adds a KotaClient namespace, are far past the repo's 300-line
file-size guideline, and concentrate module-owned shapes in core. The
recently-completed CLI/KotaClient migration cluster (see
`task-define-kota-client-contract-and-route-every-cli-su` and the
operator-utility cluster) ended with 23 namespaces — `workflow`,
`approvals`, `secrets`, `tasks`, `memory`, `ownerQuestions`, `history`,
`knowledge`, `sessions`, `modules`, `agents`, `skills`, `harnessParity`,
`webhook`, `voice`, `web`, `mcpServer`, `audit`, `config`,
`modulesAdmin`, `daemonOps`, `doctor`, `evalHarness` — every one of
which is owned by a specific module under `src/modules/*` whose
`localClient(ctx)` factory already lives there.

The asymmetry is sharp: the local-side handlers are module-owned, but
the namespace's TypeScript shape (interfaces, request/response types)
and the daemon-side HTTP wire code both live centrally in
`src/core/server/`. Adding a 24th namespace today still requires
editing two files in `src/core/server/` even though the underlying
state, route, and handler all live in one module. That violates the
"single way" rule from the architecture doc — modules should be the
ownership boundary for namespace contributions, not a central registry
that core re-edits every time.

## Desired Outcome

Each module owns its KotaClient namespace end-to-end:

- The namespace's TypeScript interface and its request/response types
  live alongside the rest of that module's code, not in
  `src/core/server/kota-client.ts`.
- The module exposes a daemon-side client factory parallel to the
  existing `localClient(ctx)` factory (e.g. `daemonClient(link)` on
  `KotaModule`) that returns the namespace's wire-call implementation
  using the daemon HTTP link the core composer hands it.
- `src/core/server/kota-client.ts` shrinks to a thin protocol surface:
  the `KotaClient` aggregate type, the `KOTA_CLIENT_NAMESPACES`
  registration helper, and any genuinely cross-namespace primitives.
  No per-namespace request/response shapes remain.
- `src/core/server/daemon-client.ts` shrinks to a thin
  `DaemonControlClient` composer: it owns the HTTP transport (base
  URL, bearer token, fetch-with-timeout), exposes a typed link object
  to module factories, and aggregates module-contributed namespace
  implementations into one `KotaClient`. No per-namespace wire methods
  remain on the class.
- The module loader registers daemon-side handlers from each module the
  same way it already registers `localClient` handlers; the selector
  validates that every declared namespace has both a local handler and
  a daemon handler.
- Both `kota-client.ts` and `daemon-client.ts` end up under the repo's
  300-line file-size guideline.

## Constraints

- One mechanism. Do not add a second public client surface or a second
  module-contribution path — daemon-side handlers register through a
  factory on `KotaModule` shaped like `localClient`.
- The HTTP daemon link object exposed to module factories is typed and
  small (e.g. `request<T>(method, path, body?)`, plus any shared
  helpers genuinely needed by more than one namespace). Modules do not
  reach into `node:http`, the bearer token, or `.kota/daemon-control.
  json` directly.
- `KotaClient` stays the single typed surface CLI code imports. The
  aggregate interface itself may stay in `src/core/server/`, but the
  per-namespace interfaces it composes over are imported from each
  owning module.
- Existing daemon HTTP routes and wire shapes are preserved exactly —
  this is an internal refactor, not a protocol change. CLI behavior,
  daemon-up/daemon-down branches, and JSON / pipe-mode output do not
  change.
- The existing namespace-registration guard at
  `src/core/server/kota-client-guard.test.ts` is updated, not
  duplicated. The new invariant — every namespace's types and wire
  code live in its owning module — is enforced mechanically (e.g. a
  guard test rejecting per-namespace request/response types in
  `src/core/server/`).
- No legacy or compatibility surface. Delete the old centralized type
  declarations and class fields as the migration completes; do not
  leave deprecation shims.
- Output continues to flow through `src/modules/rendering`. The
  rendering layer is not part of this refactor.
- The `cli`, `module-manager`, `bootstrap` exemption (`init`,
  `registry`, `completion`, `daemon-ops install`) and the existing
  direct-`.kota/`-read guard remain untouched.

## Done When

- `src/core/server/kota-client.ts` is under the 300-line guideline and
  declares only the `KotaClient` aggregate plus the namespace
  registration mechanism. Per-namespace interfaces and types are
  imported from owning modules.
- `src/core/server/daemon-client.ts` is under the 300-line guideline
  and contains only the HTTP transport composer plus a small typed
  daemon-link object handed to module factories. No per-namespace
  wire methods remain on the class.
- Every module that contributes a KotaClient namespace declares its
  interface and its daemon-side factory locally (e.g. in
  `src/modules/<name>/client.ts` or alongside `localClient(ctx)`).
- `KotaModule` carries a typed `daemonClient` factory hook parallel to
  `localClient`; the loader and selector validate that every declared
  namespace has both a local and a daemon handler.
- A guard test rejects new per-namespace request/response type
  declarations under `src/core/server/`. The existing namespace-
  registration guard is updated to enumerate the new factory hook.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Daemon-up and daemon-down CLI transcripts demonstrate parity with the
  pre-refactor behavior for at least one mutation and one read per
  every namespace surface.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-25T23-43-01-233Z-explorer-9c0zp6/` after the
operator-utility CLI cluster landed on 2026-04-26 (commit
`a7214b7d`, "Migrate operator utility CLIs and lock direct .kota
reads"). With every CLI subcommand now consuming
`ctx.client.<namespace>.<method>()`, the central files in
`src/core/server/` are the last asymmetry in the otherwise
module-owned KotaClient model: 23 module-owned namespaces still have
their TypeScript shape and daemon-side wire code centralized in two
1.5–2k-line files in core, growing every time a module adds or
extends a namespace. The recent core-shrinking direction
(model-pricing seam, REPL extraction, module HTTP routes through the
daemon control server) makes this the natural next step.

## Initiative

Module-first, core-shrinking architecture: every operator-facing
capability — including its KotaClient contract — lives in the owning
module, with `src/core/` reduced to genuine cross-cutting protocols
and runtime primitives.

## Acceptance Evidence

- Diff covering namespace type and wire-code moves out of
  `src/core/server/`, the new `daemonClient` factory hook on
  `KotaModule`, the loader/selector wiring, and the new guard test.
- Line-count snapshots of `src/core/server/kota-client.ts` and
  `src/core/server/daemon-client.ts` before and after, both under the
  300-line guideline after.
- Daemon-up and daemon-down CLI transcripts under the run directory
  showing one read and one mutation per namespace surface still
  behaves identically (or representative coverage demonstrating no
  protocol change).
- Test output showing the new guard test passing on the current tree
  and failing on a deliberately-introduced per-namespace type added
  back into `src/core/server/`.
