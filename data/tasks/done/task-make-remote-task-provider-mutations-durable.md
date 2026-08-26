---
id: task-make-remote-task-provider-mutations-durable
title: Make remote task provider mutations durable
status: done
priority: p1
area: modules
task_class: Platform
depends_on: [task-add-one-policy-aware-outbound-http-transport]
summary: Replace duplicated fire-and-forget GitHub, Linear, and Jira task mutations with one awaited, observable remote mutation contract.
created_at: 2026-07-31T16:01:01.621Z
updated_at: 2026-08-26T16:27:38.955Z
---

## Problem

The core `TaskProvider` mutation API is synchronous, but GitHub, Linear, and
Jira are remote systems. Each provider duplicates an in-memory cache,
negative temporary ids, optimistic status changes, and background HTTP writes.
Many writes end in `.catch(() => {})`; failures leave local state claiming a
mutation that the remote source of truth rejected. The three implementations
repeat the same unreliable algorithm with vendor-specific details mixed in.

## Desired Outcome

Define one asynchronous remote task mutation contract with typed outcomes,
stable remote identity, awaited persistence, reconciliation, and observable
failure. GitHub, Linear, and Jira implement only vendor mapping and transport;
shared mutation orchestration owns pending/confirmed/failed state.

## Constraints

- Do not preserve synchronous fire-and-forget methods as a compatibility path.
  Update callers to await the canonical mutation outcome.
- The configured remote provider remains authoritative. Do not report success
  or terminal task state until the remote operation is confirmed.
- Do not create a second durable task queue beside the existing workflow/task
  ownership model. If a retry is justified, record it through the existing
  typed runtime/DLQ mechanism with idempotency evidence.
- Use the canonical outbound HTTP transport and typed vendor error mapping.
- No swallowed promise rejection or unobservable best-effort mutation remains.

## Done When

- `TaskProvider` separates local synchronous stores from remote async mutation
  capability through one explicit typed interface.
- GitHub, Linear, and Jira share mutation lifecycle/reconciliation code and no
  longer use local negative ids or optimistic fire-and-forget writes.
- Add, claim/start, complete, reopen, label/transition, archive, and partial
  multi-call failures return truthful typed outcomes and converge on remote
  state after restart/reload.
- Operator status/health exposes actionable provider mutation failures without
  leaking credentials.

## Source / Intent

The single-mechanism audit found the same temporary-id/cache algorithm in
`src/modules/github/task-provider.ts`, `linear/task-provider.ts`, and
`jira/task-provider.ts`, with numerous empty `.catch(() => {})` handlers. This
is both duplicated capability code and a correctness gap hidden by the current
synchronous core interface.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- Deterministic provider transcripts for successful create/update and injected
  create, transition, label/comment, timeout, and restart failures across all
  three vendors.
- A reconciliation artifact proving local/operator state matches the remote
  fixture after partial failure and process restart.
- A structural search proving negative temporary ids, best-effort mutation
  comments, empty mutation catches, and duplicate lifecycle implementations
  are gone.

## Completion

The provider protocol now separates synchronous reads from awaited mutation
capabilities. GitHub, Linear, and Jira update their caches only after the remote
system acknowledges the write; no negative ids or fire-and-forget mutation
catches remain. Linear UUIDs and Jira ids project through the shared stable
remote-identity seam so reload order cannot renumber work.
