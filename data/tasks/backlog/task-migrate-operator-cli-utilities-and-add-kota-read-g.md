---
id: task-migrate-operator-cli-utilities-and-add-kota-read-g
title: Migrate operator utility CLIs and add direct .kota read guard
status: backlog
priority: p2
area: architecture
summary: Migrate the remaining operator utility CLIs (module-manager, config, daemon-ops control, doctor, eval-harness, guardrails-audit) to ctx.client.* and add the sibling guard test rejecting new direct .kota/ reads from non-bootstrap CLI code.
created_at: 2026-04-25T20:31:21.442Z
updated_at: 2026-04-25T20:31:21.442Z
---

## Problem

The remaining un-migrated operator utility CLIs — `module-manager`,
`config`, `daemon-ops` control, `doctor`, `eval-harness`, and
`guardrails-audit` — still resolve their data through
`ModuleContext` services or direct `.kota/` reads inside the action
handlers. The umbrella migration is also missing the sibling guard
test that rejects new direct `.kota/` filesystem reads from non-
bootstrap CLI code, which the parent task lists as the final
invariant. Without that guard, future CLI subcommands can quietly
re-introduce direct `.kota/` reads even after every existing
subcommand routes through the contract.

## Desired Outcome

- Every `kota module`, `kota config`, `kota daemon-ops` control
  subcommand, `kota doctor`, `kota eval-harness`, and
  `kota guardrails-audit` action handler routes through
  `ctx.client.<namespace>.<method>()`. No service resolution from
  `ModuleContext` or direct `.kota/` reads in those handlers.
- `KotaClient` declares typed namespaces for each (e.g.
  `ModuleManagerClient`, `ConfigClient`, `DaemonOpsClient`,
  `DoctorClient`, `EvalHarnessClient`, `GuardrailsAuditClient`),
  with discriminated result shapes per operation.
- `DaemonControlClient` and the per-module `localClient(ctx)`
  factories implement the namespaces; daemon-required mutations
  surface `{ ok: false, reason: "daemon_required" }` from the local
  handler.
- Daemon adds matching HTTP routes under bearer auth; existing
  routes are extended where they already exist.
- The bootstrap exemption in the parent task stays limited to
  `init`, `registry`, `completion`, and `daemon-ops install`. Any
  new bootstrap exemption is documented in the owning module's
  local `AGENTS.md`.
- A new sibling guard test (paired with the existing namespace-
  registration guard at
  `src/core/server/kota-client-guard.test.ts`) enumerates the
  bootstrap exemption and rejects new direct `.kota/` filesystem
  reads from any non-bootstrap CLI subcommand action handler under
  `src/modules/*`.
- Focused unit tests cover the daemon-down branches per namespace.

## Constraints

- Do not introduce a second public client surface; everything routes
  through `KotaClient`.
- Output continues to flow through `src/modules/rendering`.
- Existing JSON / pipe-mode behavior for every migrated subcommand
  is preserved.
- The sibling guard test is filesystem-static — it greps source,
  not runtime. It must run inside `pnpm test` without requiring a
  live daemon or live `.kota/` state.
- Sequence after the other three decomposed clusters; the guard
  test only makes sense to land once every non-bootstrap CLI
  subcommand it would otherwise flag has already been migrated.

## Done When

- All listed modules' CLI subcommands route every read and mutation
  through `ctx.client.<namespace>.<method>()`.
- `KOTA_CLIENT_NAMESPACES` enumerates the new namespaces; the
  existing namespace-registration guard test covers them.
- The new sibling guard test rejects any non-bootstrap CLI
  subcommand under `src/modules/*` that reads `.kota/` directly,
  with the bootstrap exemption (`init`, `registry`, `completion`,
  `daemon-ops install`) declared in code rather than in prose.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green; the new
  unit and guard tests run as part of the suite.
- Daemon-up and daemon-down CLI transcripts demonstrate parity for
  each migrated subcommand.
- The parent migration's invariant — every non-bootstrap CLI
  subcommand under `src/modules/*` consumes
  `ctx.client.<namespace>.<method>()` — is enforced mechanically by
  the sibling guard rather than by reviewer vigilance.

## Source / Intent

Decomposed from
`task-migrate-remaining-cli-subcommands-to-kotaclient-co` (see
that task's "Source / Intent" for the original 2026-04-25 owner
capture from `data/inbox/cli-still-feels-poor.md`). This task is
the final cluster: it migrates the last operator utility CLIs and
lands the sibling guard test that locks the invariant in place.

## Initiative

Product-grade KOTA clients: a single daemon control contract that
the CLI, native/web/mobile apps, and future operator clients all
consume the same way, with the CLI as the reference interactive
client.

## Acceptance Evidence

- Diff covering namespace additions to `kota-client.ts`, daemon-
  client property impls, route additions in each owning module,
  `registerLocalClient(...)` calls, and the new sibling guard test.
- Updated namespace-registration guard test enumerating the new
  namespaces.
- Daemon-up and daemon-down CLI transcripts under the run directory
  demonstrating parity for each migrated subcommand.
- Test output showing the new sibling guard test passing on the
  current tree and failing on a deliberately-introduced direct
  `.kota/` read in a non-bootstrap CLI handler (captured as a
  short transcript).
