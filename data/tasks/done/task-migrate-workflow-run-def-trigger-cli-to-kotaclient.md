---
id: task-migrate-workflow-run-def-trigger-cli-to-kotaclient
title: Migrate workflow run, definition, and trigger/exec CLIs to KotaClient
status: done
priority: p2
area: architecture
summary: Migrate the remaining workflow-ops CLI subcommands (run management, definition mutations, trigger/exec) to ctx.client.workflow.* so the entire workflow-ops module routes through the KotaClient contract.
created_at: 2026-04-25T20:31:21.442Z
updated_at: 2026-04-25T21:12:30.280Z
---

## Problem

The eight `kota workflow` control subcommands (`abort`, `cancel`,
`pause`, `resume`, `reload`, `disable`, `enable`, `status`) were
migrated to `ctx.client.workflow.*` in run
`2026-04-25T16-09-18-430Z-builder-dhnx9j` (critic verdict pass; the
run timed out after the work was complete and recovery stashed the
diff). The remaining workflow-ops subcommands — workflow run
management, definition mutations, and trigger/exec — still resolve
their data through `DaemonControlClient.fromStateDir()` or local
stores from inside the action handlers, leaving workflow-ops
half-migrated.

## Desired Outcome

- Every remaining `kota workflow` subcommand under workflow-ops
  (workflow run management, definition mutations, trigger/exec)
  routes through `ctx.client.workflow.<method>()`. No remaining
  `DaemonControlClient.fromStateDir()` or direct store imports from
  the action handlers.
- The `WorkflowClient` interface in
  `src/core/server/kota-client.ts` declares typed methods for each
  added subcommand with discriminated result shapes that distinguish
  the daemon-applied path from the signal-file fallback or the
  daemon-required path, mirroring the convention used by the control
  cluster.
- `DaemonControlClient` exposes the new namespace methods on
  `this.workflow` by delegating to its existing HTTP routes; the
  workflow-ops `localClient(ctx)` factory provides the matching
  daemon-down handlers using `WorkflowRunStore`, signal files, and
  `loadConfig(ctx.cwd)`.
- Daemon-required mutations surface
  `{ ok: false, reason: "daemon_required" }` from the local handler;
  the CLI maps that to a uniform "No running daemon found" message.
- Focused tests in `src/modules/workflow-ops/local-client.test.ts`
  exercise the new daemon-down branches end-to-end.

## Constraints

- Do not introduce a second public client surface; everything routes
  through `KotaClient`.
- Output continues to flow through `src/modules/rendering`. CLI
  formatting stays in the action handlers; the contract returns
  data.
- Existing JSON / pipe-mode behavior for every migrated subcommand
  is preserved.
- Sequence after the parent migration: this cluster builds on the
  workflow control cluster's `WorkflowClient` shape; do not duplicate
  helpers already established in that cluster.

## Done When

- Every remaining `kota workflow` subcommand routes through
  `ctx.client.workflow.<method>()`.
- The `WorkflowClient` interface and `KOTA_CLIENT_NAMESPACES`
  enumerate the new methods; the namespace-registration guard test
  in `src/core/server/kota-client-guard.test.ts` covers them.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green; the new
  unit tests run as part of the suite.
- `pnpm kota workflow status`, `pnpm kota workflow list`, and
  representative trigger/exec runs produce identical output between
  daemon-up and daemon-down captures.

## Source / Intent

Decomposed from
`task-migrate-remaining-cli-subcommands-to-kotaclient-co`
(see that task's "Source / Intent" for the original 2026-04-25
owner capture from `data/inbox/cli-still-feels-poor.md`). The
control cluster shipped in run
`2026-04-25T16-09-18-430Z-builder-dhnx9j` (critic pass; timeout-
shaped recovery) — this task carries forward the rest of the
workflow-ops module migration.

## Initiative

Product-grade KOTA clients: a single daemon control contract that
the CLI, native/web/mobile apps, and future operator clients all
consume the same way, with the CLI as the reference interactive
client.

## Acceptance Evidence

- Diff covering namespace additions to `kota-client.ts`, daemon-
  client property impls, route additions in workflow-ops, and
  `registerLocalClient(...)` calls.
- Updated namespace-registration guard test enumerating every new
  method.
- Daemon-up and daemon-down CLI transcripts under the run directory
  demonstrating parity for each migrated subcommand.
- Grep evidence in the run directory that no remaining workflow-ops
  CLI handler imports `DaemonControlClient.fromStateDir()` or
  reads `.kota/` directly.
