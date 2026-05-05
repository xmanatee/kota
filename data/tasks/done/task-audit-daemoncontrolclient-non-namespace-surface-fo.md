---
id: task-audit-daemoncontrolclient-non-namespace-surface-fo
title: Audit DaemonControlClient non-namespace surface for residual duplication
status: done
priority: p1
area: architecture
summary: Audit DaemonControlClient non-namespace methods (workflow control, approvals, sessions, events) for residual duplication against the typed KotaClient namespace contract; record verdict per method and either delete duplicates or document why they must remain transport-only primitives.
created_at: 2026-05-05T08:51:50.441Z
updated_at: 2026-05-05T09:03:30.496Z
---

## Problem

After the 26-step KotaClient namespace migration cluster closed at
commit `94948ce5` (2026-05-05) and `daemon-client.ts` shrank to 295
lines via the sibling-file extract into `daemon-control-methods.ts`
(293 lines), `DaemonControlClient` still exposes ~28 non-namespace
methods that overlap in spirit with typed `KotaClient` namespace
contracts:

- **Workflow runtime control:** `pause`, `resume`, `abort`, `reload`,
  `enableWorkflow`, `disableWorkflow`, `trigger`, `dryRun`, `abortRun`,
  `cancelRun`, `getWorkflowStatus`, `getWorkflowDefinitions`,
  `listWorkflowRuns`, `getWorkflowRun`. The matching `WorkflowClient`
  namespace already exposes `pause`, `resume`, `abort`, `reload`,
  `triggerByName`, `cancelRun`, `abortRun` with richer typed daemon-
  up/daemon-down discriminated unions (`WorkflowPauseResult`,
  `WorkflowAbortResult`, `WorkflowReloadResult`, …). The non-namespace
  surface returns the raw `null`-on-network-failure HTTP wire shape.
- **Approvals queue:** `listApprovals`, `approveApproval`,
  `rejectApproval`, `approveAllApprovals`, `rejectAllApprovals`. The
  matching `ApprovalsClient` namespace exposes `list`, `approve`,
  `reject` (no batch arms today).
- **Daemon health/identity:** `getHealth`, `getDaemonStatus`,
  `getCapabilities`, `getIdentity`. `DaemonOpsClient` exposes typed
  `status`, `pid` with discriminated `running`/`not_running`/`stale`
  state arms; the non-namespace methods return the raw HTTP body or
  `null`.
- **Sessions registry:** `registerSession`, `unregisterSession`. No
  matching namespace method (the `SessionsClient` namespace is for
  CLI-facing list/setAutonomyMode); these are transport primitives
  used by the in-process session bootstrap when `kota serve` registers
  itself with its own daemon.
- **Events:** `queryEvents`, `events()` (SSE). No matching namespace
  surface (no `events` namespace on `KotaClient`).
- **Config reload:** `reloadConfig`. `DaemonOpsClient.reload()` is the
  typed CLI-facing method; the wire-level `reloadConfig` is the inner
  primitive.

The `task-decouple-non-namespace-daemon-transport-methods-fr` task
(done 2026-05-03) removed direct `DaemonControlClient` imports from
modules but did not collapse the duplicate surface. The remaining
in-tree consumers of the non-namespace methods are:

- `src/core/server/daemon-link.test.ts` — integration smoke
- `src/core/server/server.ts` — daemon-side server bootstrap
- `src/core/server/server-routes.ts` — daemon proxy routes
- `src/core/daemon/daemon-control-workflow.ts` — daemon-side workflow
  control surface
- `src/core/daemon/daemon-control-sessions.ts` — daemon-side session
  control surface
- `src/modules/slack-channel/index.ts` — channel-internal probe

These callers never touch CLI subcommand code; they sit on the daemon
side or in integration plumbing. The duplication is real but the cost
of removing the non-namespace surface is non-trivial — namespaces
return discriminated unions with daemon-up/down branching, while
internal daemon-side callers want raw wire-level access without the
fallback layer.

## Desired Outcome

A run-directory artifact records, per non-namespace method, one of:

- **Delete:** the method has no remaining caller after migrating
  callers to the equivalent namespace, and is removed from
  `DaemonControlClient` and `daemon-control-methods.ts`. Migration
  lands in the same change.
- **Keep, transport-only:** the method is genuinely a transport
  primitive (no CLI-facing equivalent, internal daemon-side caller,
  or wire-level access required) and is documented in
  `src/core/server/AGENTS.md` as such, with a short rationale.
- **Promote to namespace:** the method should become part of an
  existing or new namespace (e.g. batch approvals arms folded into
  `ApprovalsClient`; an `events` namespace introduced on `KotaClient`
  if `queryEvents`/`events()` belong there). The promotion lands in
  the same change with the namespace contract updated end-to-end.

After this audit and the resulting change set:

- `daemon-client.ts` and `daemon-control-methods.ts` together hold only
  methods that pass the audit's "keep, transport-only" or "namespace-
  internal wire helper" tests.
- `src/core/server/AGENTS.md` records the durable rule for when a
  daemon-side surface belongs on `DaemonControlClient` vs. on a
  namespace, so future additions do not re-create the duplication.
- No silent compatibility shims, no deprecation comments, and no
  parallel public client surface.

## Constraints

- Daemon HTTP wire shape, status-code branches (404, 409, 422), and the
  `null`-on-network-failure contract for transport-only methods stay
  exactly as they are. CLI behavior under daemon-up and daemon-down
  branches is preserved.
- The existing namespace-registration guard
  (`src/core/server/kota-client-guard.test.ts`) and the per-module
  `daemon-client.test.ts` files keep passing. If a namespace gains a
  method (e.g. `approvals.approveAll`), update the corresponding
  guard test in the same change.
- `src/core/server/` continues to own `node:http` access, the bearer
  token, and `.kota/daemon-control.json` reads. No other directory
  reaches into those primitives.
- The audit verdict must be load-bearing: each "keep, transport-only"
  decision cites the specific in-tree caller(s) that require raw wire
  access; each "delete" or "promote" decision lists the migrated
  callers and the unified return shape.
- Do not introduce a second public client surface alongside
  `DaemonControlClient`. If a namespace gains a new method, it lands
  on the existing namespace.
- Both `daemon-client.ts` and `daemon-control-methods.ts` end at or
  under the 300-line guideline; if either threatens to drift over,
  factor the residual deletion or extraction in the same change.

## Done When

- A `<run-directory>/non-namespace-audit.md` artifact records the
  per-method verdict (delete, keep transport-only, promote to
  namespace) with a one-paragraph rationale and a list of in-tree
  callers per method.
- Every "delete" or "promote" verdict lands as code in the same
  change: callers are migrated, the duplicate method is removed from
  `DaemonControlClient` and `daemon-control-methods.ts`, and (if
  promoted) the owning namespace's contract and module-side
  `daemonClient(link)` factory are extended.
- `src/core/server/AGENTS.md` codifies when a daemon-side surface
  belongs on a namespace versus on `DaemonControlClient` as a
  transport primitive.
- `wc -l src/core/server/daemon-client.ts` and
  `wc -l src/core/server/daemon-control-methods.ts` both report at
  or under 300 lines.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- The existing `kota-client-guard.test.ts` and per-module
  `daemon-client.test.ts` files pass with any namespace contract
  changes reflected in their fixtures.

## Source / Intent

Surfaced by the explorer in
`.kota/runs/2026-05-05T08-40-59-932Z-explorer-ou517c/` after the
parent KotaClient namespace migration closed (`task-distribute-
kotaclient-namespace-types-and-daemon-s` and `task-drive-daemon-
clientts-under-the-300-line-guideline` both landed in `done/` between
2026-05-03 and 2026-05-05). The cluster reached a clean rest point on
the namespace dimension, but the residual non-namespace surface on
`DaemonControlClient` keeps two paths to the same daemon RPC alive
(e.g. `client.workflow.pause()` vs. `daemonControl.pause()`). Closing
this audit either eliminates the duplication or codifies the seam so
future contributors do not re-introduce it accidentally. The 295/293-
line current state of the two server files leaves ~5 lines of
headroom; an honest audit is needed before the next consolidation
addition pushes either file over the guideline again.

## Initiative

Module-first, core-shrinking architecture with one clear way per job:
every operator-facing daemon RPC has exactly one typed entry point
through `KotaClient`, and `src/core/server/` retains only the
transport primitives that genuinely cannot live on a namespace.

## Acceptance Evidence

- The `<run-directory>/non-namespace-audit.md` artifact captures the
  per-method verdict and load-bearing caller cites.
- Diff covering caller migrations, duplicate-method deletions, any
  namespace contract extensions, and the `AGENTS.md` rule update.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` transcripts under the
  run directory showing all green.
- `wc -l` snapshots of the two server files before and after the
  change, recorded under the run directory.
