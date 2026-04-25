---
id: task-migrate-agent-skill-harness-cli-to-kotaclient-cont
title: Migrate agent-ops, skill-ops, and harness-parity CLIs to KotaClient
status: done
priority: p2
area: architecture
summary: Migrate the agent-ops, skill-ops, and harness-parity CLI subcommands to ctx.client.<namespace>.<method> so per-agent configuration surfaces all consume the KotaClient contract.
created_at: 2026-04-25T20:31:21.442Z
updated_at: 2026-04-25T22:14:47.064Z
---

## Problem

The `agent-ops`, `skill-ops`, and `harness-parity` modules each
expose CLI subcommands that today resolve their data through stores
imported from `ModuleContext` or direct `.kota/` reads inside the
action handlers. They have not been migrated to the `KotaClient`
contract that the foundation task established and that newer
clusters (workflow control, repo-tasks, owner-questions, history,
knowledge, memory, secrets, approvals) already use.

## Desired Outcome

- Every `kota agent`, `kota skill`, and `kota harness-parity`
  subcommand routes through
  `ctx.client.{agents,skills,harnessParity}.<method>()`. No store
  imports or direct `.kota/` reads in the action handlers.
- `KotaClient` declares typed `AgentsClient`, `SkillsClient`, and
  `HarnessParityClient` namespaces with discriminated result shapes
  for each operation (read vs. mutation, found vs. not_found,
  daemon-required surfaces where applicable).
- `DaemonControlClient` and the per-module `localClient(ctx)`
  factories implement the namespaces; daemon-required mutations
  surface `{ ok: false, reason: "daemon_required" }` from the local
  handler.
- Daemon adds the matching HTTP routes for each namespace under
  bearer auth; existing routes are extended where they already
  exist.
- Focused tests cover the daemon-down branches per namespace.

## Constraints

- Do not introduce a second public client surface; everything routes
  through `KotaClient`.
- Output continues to flow through `src/modules/rendering`.
- Existing JSON / pipe-mode behavior for every migrated subcommand
  is preserved.
- Each module's mutation logic lives in a shared helper (mirroring
  `src/modules/repo-tasks/repo-tasks-operations.ts`) so daemon route
  handlers and local-client handlers cannot diverge.

## Done When

- All three modules' CLI subcommands route every read and mutation
  through `ctx.client.<namespace>.<method>()`.
- `KOTA_CLIENT_NAMESPACES` enumerates `agents`, `skills`, and
  `harnessParity`; the namespace-registration guard test covers
  them.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green; the new
  unit tests run as part of the suite.
- Daemon-up and daemon-down CLI transcripts demonstrate parity for
  each migrated subcommand.

## Source / Intent

Decomposed from
`task-migrate-remaining-cli-subcommands-to-kotaclient-co` (see
that task's "Source / Intent" for the original 2026-04-25 owner
capture from `data/inbox/cli-still-feels-poor.md`). These three
modules cluster as the "per-agent-context" CLI surfaces and ship
together so the contract grows by a coherent slice.

## Initiative

Product-grade KOTA clients: a single daemon control contract that
the CLI, native/web/mobile apps, and future operator clients all
consume the same way, with the CLI as the reference interactive
client.

## Acceptance Evidence

- Diff covering namespace additions to `kota-client.ts`, daemon-
  client property impls, route additions in each owning module, and
  `registerLocalClient(...)` calls.
- Updated namespace-registration guard test enumerating the three
  new namespaces.
- Daemon-up and daemon-down CLI transcripts under the run directory
  demonstrating parity for each migrated subcommand.
- Grep evidence in the run directory that no `kota agent`,
  `kota skill`, or `kota harness-parity` action handler imports
  stores directly or reads `.kota/`.
