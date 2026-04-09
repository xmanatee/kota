---
id: task-approval-request-expiry
title: Add configurable TTL and auto-expiry for pending approval requests
status: done
priority: p3
area: runtime
summary: Approval requests sit pending indefinitely when no operator is available. A configurable TTL auto-rejects expired requests with a recorded reason and a bus event, preventing workflows from blocking forever.
created_at: 2026-03-30T20:33:00Z
updated_at: 2026-03-30T22:30:00Z
---

## Problem

Approval requests block the workflow that created them until an operator acts. If an
operator is unavailable — offline, on holiday, or simply missed the notification — the
workflow hangs indefinitely. There is no automatic fallback, no recorded expiry, and no
operator notification when a request times out. Long-lived blocked workflows consume
resources and prevent subsequent queued work from running.

## Desired Outcome

A `timeoutMs` field on approval requests (set at the workflow step level or globally in
daemon config as a default). When a pending request ages past its TTL:
- It is auto-rejected with `reason: "expired"` and a `resolvedAt` timestamp.
- An `approval.expired` event is emitted on the bus so notification modules can
  surface it to the operator.
- The workflow receives the rejection and follows the normal rejection path (fail or
  retry, depending on step config).

## Constraints

- Entirely opt-in: existing behavior is unchanged when no timeout is configured.
- Auto-rejection writes the same approval record format as a manual rejection; no new
  schema fields required beyond `timeoutMs` on the request and `reason` on the resolution.
- Daemon enforces TTL via a periodic sweep (e.g. the existing scheduler tick), not a
  per-request timer, to keep implementation simple and restartable.
- `approval.expired` must be a named event in `BusEvents` so notification modules
  can subscribe without hard-coding strings.
- No new store required; augment the existing approval record.

## Done When

- `timeoutMs` accepted on approval step definition and as a global daemon config default.
- Pending approval auto-rejected after TTL with `reason: "expired"` in the stored record.
- `approval.expired` event emitted to the bus on auto-rejection.
- Existing approval flow unaffected when no timeout is set.
- Unit test covers the expiry path; integration test verifies the bus event is emitted.
