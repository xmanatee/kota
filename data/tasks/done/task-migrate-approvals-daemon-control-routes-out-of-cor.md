---
id: task-migrate-approvals-daemon-control-routes-out-of-cor
title: Migrate /approvals daemon-control routes out of core via controlRoutes
status: done
priority: p2
area: architecture
summary: Migrate the /approvals, /approvals/:id/approve, /approvals/:id/reject, /approvals/approve-all, /approvals/reject-all daemon-control endpoints from src/core/daemon/daemon-control-approvals.ts into the approval-queue module via KotaModule.controlRoutes, mirroring the history and voice migration pattern, and add an import-guard test refusing reintroduction.
created_at: 2026-04-25T05:55:47.377Z
updated_at: 2026-04-25T06:07:06.747Z
---

## Problem

`src/core/daemon/daemon-control.ts` still hard-codes the five `/approvals*`
control-plane routes (`GET /approvals`, `POST /approvals/:id/approve`,
`POST /approvals/:id/reject`, `POST /approvals/approve-all`,
`POST /approvals/reject-all`) and dispatches them through
`src/core/daemon/daemon-control-approvals.ts`. The `approval-queue` module
already owns the `ApprovalQueue` state, the operator CLI subcommands, and a
parallel public `/api/approvals*` route surface
(`src/modules/approval-queue/routes.ts`). The two implementations duplicate
the same logic — one routed through `DaemonControlHandle.{listApprovals,
approveApproval, rejectApproval, approveAllApprovals, rejectAllApprovals}`
in core, the other reading `getApprovalQueue()` directly in the module —
and the only reason both exist is that the `controlRoutes` seam did not
exist when the daemon control handlers were written.

The `controlRoutes` seam landed with the voice migration (`aa59e6f8`) and
was just applied to history (`d8655ed0`). `src/core/daemon/AGENTS.md` now
names "voice and history both contribute through it today; future
module-owned endpoints follow the same pattern" — approvals are the next
clearest application: a module-owned domain (`approval-queue`) with module-
owned state (`ApprovalQueue`), module-owned CLI, but core-resident control-
plane handlers and a `DaemonControlHandle` shim that exists only to feed
those handlers. Today the approval-queue module's `AGENTS.md` already
claims it "Provides … HTTP route handlers for approvals", which is true
for `/api/approvals*` but not yet for the daemon-control surface.

## Desired Outcome

The five `/approvals*` daemon-control endpoints are contributed by the
`approval-queue` module through `KotaModule.controlRoutes`, exactly the
way the history module contributes `/history`, `/history/:id` and the
voice module contributes `/voice/transcribe`, `/voice/synthesize`.
`src/core/daemon/daemon-control-approvals.ts` is deleted along with its
route-scope and dispatch entries in `daemon-control.ts`, and the
`DaemonControlHandle` approval methods (`listApprovals`,
`approveApproval`, `rejectApproval`, `approveAllApprovals`,
`rejectAllApprovals`) are removed from `daemon-control-types.ts` and
`daemon-handle.ts` once nothing in core still needs them. The two parallel
implementations collapse to one shared module-side function family used by
both the public `/api/approvals*` routes and the new `/approvals*` control
routes. A new import-guard test refuses any future reintroduction of
`daemon-control-approvals*.ts` under `src/core/daemon/`. The wire contract
— bearer-token check, `read` scope on `GET /approvals`, `control` scope on
the four mutating routes, `{ approvals: PendingApproval[] }` /
`{ approval: PendingApproval }` / `{ approvals, count }` response shapes,
404 on missing-or-not-pending — is preserved and covered by a co-located
`DaemonControlServer`-based test in the approval-queue module, mirroring
the voice and history modules' pattern. Route-key collisions with built-
ins or with another module's contribution still throw at server
construction.

## Constraints

- Use the existing `KotaModule.controlRoutes` seam. Do not introduce a
  parallel registration path or a shadow router.
- Preserve the existing route paths (`GET /approvals`,
  `POST /approvals/:id/approve`, `POST /approvals/:id/reject`,
  `POST /approvals/approve-all`, `POST /approvals/reject-all`),
  capability scopes (`read` for the GET, `control` for the four POSTs —
  match the current `BUILTIN_ROUTE_SCOPES` table in `daemon-control.ts`),
  bearer-token gating, status codes, and response shapes
  (`{ approvals: PendingApproval[] }` for list,
  `{ approval: PendingApproval }` for individual approve/reject,
  `{ approvals, count }` for the bulk endpoints,
  `404 { error: "Approval not found or not pending" }` for missing).
- The handler implementation must live once in the approval-queue module.
  Collapse the duplicated logic between `routes.ts`'s public `/api/approvals*`
  handlers and the new `controlRoutes` handlers into shared functions in
  the module; do not leave two bodies of the same logic in different
  files.
- Core must not import from `#modules/approval-queue/*`. The repo-wide
  guard in `src/core/agent-harness/no-module-imports-in-core.test.ts`
  already enforces this; do not weaken it. Add a dedicated import-guard
  test under `src/core/daemon/` (e.g. `no-daemon-control-approvals.test.ts`)
  that refuses any new `daemon-control-approvals*.ts` under
  `src/core/daemon/`, matching the history migration's
  `no-daemon-control-history.test.ts` precedent.
- Remove `DaemonControlHandle.{listApprovals, approveApproval,
  rejectApproval, approveAllApprovals, rejectAllApprovals}` and the
  corresponding `daemon-handle.ts` implementations once nothing in core
  still needs them. The module reaches `getApprovalQueue()` directly,
  which the current module-side `routes.ts` already does — so the handle
  shim should be deletable in full.
- Existing daemon-control client wrappers
  (`DaemonControlClient.{listApprovals, approveApproval, rejectApproval,
  approveAllApprovals, rejectAllApprovals}`) and any callers in CLI/web/
  native paths must continue to work unchanged. Adjust internal wiring if
  needed, but do not change the wire contract.
- Update `src/core/daemon/AGENTS.md` and `src/modules/approval-queue/AGENTS.md`
  so each describes the new seam location truthfully. Remove
  `daemon-control-approvals.ts` from the "internal subdomains"
  enumeration in the daemon `AGENTS.md`; expand the approval-queue module
  `AGENTS.md` to name `/approvals*` as a `controlRoutes` contribution.

## Done When

- `src/core/daemon/daemon-control-approvals.ts` is deleted.
- `src/core/daemon/daemon-control.ts` no longer references any approval
  route, scope, or handler — the file's import list, the
  `BUILTIN_ROUTE_SCOPES` table, and the dispatch switch are clean of
  `/approvals` entries.
- The approval-queue module declares the five routes through
  `KotaModule.controlRoutes` with the correct `capabilityScope` per
  method, and a co-located `DaemonControlServer`-based test exercises
  list/approve/reject/approve-all/reject-all end-to-end against the
  registered routes including the `read`/`control` capability-scope split.
- `daemon-handle.ts` and `daemon-control-types.ts` no longer carry the
  five approval methods on `DaemonControlHandle` once nothing in core
  still calls them.
- The two duplicated handler bodies (core's `daemon-control-approvals.ts`
  and module's `routes.ts`) have collapsed into one shared function
  family inside the module.
- An import-guard test rejects any new `daemon-control-approvals*.ts`
  under `src/core/daemon/` — modeled on
  `no-daemon-control-history.test.ts`.
- The repo-wide `no-module-imports-in-core` guard still passes
  unmodified.
- `pnpm test` passes on the resulting branch with the new module-side
  test included.
- `src/core/daemon/AGENTS.md` and `src/modules/approval-queue/AGENTS.md`
  describe the migration's outcome accurately; no stale references to
  `daemon-control-approvals.ts` or the removed `DaemonControlHandle`
  approval methods remain anywhere in the repo.

## Source / Intent

The just-landed history migration
(`task-move-daemon-control-history-route-handlers-out-of-`, commit
`d8655ed0`) followed the voice migration (`aa59e6f8`) and updated
`src/core/daemon/AGENTS.md` to name the `controlRoutes` seam as the
recommended pattern for module-owned control-plane endpoints. Approvals
are the next clearest application: a module already owns the state, the
CLI, and a parallel public route surface, while the daemon control
handlers still live in core behind a `DaemonControlHandle` shim that
exists only for that purpose. Owner direction throughout the
architecture initiative has been "minimal core, module-first" — voice
(`aa59e6f8`), Claude-SDK executor (`f3a1b444`), architect mode
(`85bb9176`), and the `HistoryProvider` inversion (`8f12be9e`) all moved
capability out of `src/core/`. This task closes that gap before the
remaining `daemon-control-*` files calcify into core debt.

## Initiative

Minimal-core, module-first architecture: every module-owned capability
should also own its operator-facing surfaces, including HTTP control
routes. Each migration like this one shrinks the core boundary and makes
the seam discoverable as the recommended pattern for any future module
contributing control-plane endpoints. The remaining `daemon-control-*`
handlers in core (commands, metrics, owner-questions, push-tokens,
sessions, webhook, workflow) split into module-owned candidates and
genuinely-core ones; this task makes the next-clearest module-owned
candidate visible in code by completing it.

## Acceptance Evidence

- Diff showing `daemon-control-approvals.ts` deleted, `daemon-control.ts`
  cleaned of approval entries, `daemon-handle.ts` and
  `daemon-control-types.ts` cleaned of the five approval methods, the
  approval-queue module's `KotaModule` definition gaining
  `controlRoutes`, the duplicated `routes.ts` logic collapsed into one
  shared function family used by both surfaces, and the new import-guard
  test.
- New module-side `DaemonControlServer` test covering
  list/approve/reject/approve-all/reject-all including the
  `read`/`control` capability-scope split — pasted transcript or named
  test file in the run directory or PR body.
- `pnpm test` output (or relevant filtered subset) showing the new
  test green and the import-guard test green.
- Updated `src/core/daemon/AGENTS.md` and
  `src/modules/approval-queue/AGENTS.md` with the new seam wording.
