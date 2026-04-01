---
id: task-approval-request-expiration
title: Add configurable expiration and auto-resolution to approval requests
status: ready
priority: p3
area: runtime
summary: Approval requests have no timeout; if the operator is absent, the requesting workflow step hangs indefinitely until the daemon is restarted.
created_at: 2026-03-31T14:40:00Z
updated_at: 2026-03-31T14:40:00Z
---

## Problem

When a workflow step submits an approval request (`requestApproval`), it blocks until the operator responds via CLI or web UI. There is no expiration or auto-resolution mechanism. If the operator is unavailable — overnight, on vacation, or simply missed the notification — the workflow hangs indefinitely, holding a run slot and blocking any dependent work.

This is a reliability gap for production autonomous operation where unattended runs are expected.

## Desired Outcome

Approval requests have an optional `timeoutMs` field. When the deadline passes without operator action, the request auto-resolves with a configurable default outcome (`deny` is the safe default; operators can opt into `approve` for trusted non-destructive actions). A timeout resolution emits a `workflow.approval.timeout` event and records the resolution source in the approval record so operators can audit which steps were auto-resolved.

## Constraints

- Default behavior when `timeoutMs` is omitted must be the current behavior (no timeout) to avoid breaking existing workflows.
- Auto-deny is the safe default for the `defaultResolution` field; auto-approve requires explicit opt-in.
- Timeout resolution should be implemented inside the approval store or daemon, not as a workflow step retry — the step should receive the resolved value normally.
- The `workflow.approval.timeout` event should be subscribable by notification extensions (Telegram, Slack) using the existing event bus pattern.

## Done When

- `ApprovalRequest` has optional `timeoutMs` and `defaultResolution` fields.
- The daemon auto-resolves pending approvals that exceed their deadline.
- A `workflow.approval.timeout` event is emitted on auto-resolution.
- Existing approval behavior (no timeout) is unchanged when these fields are absent.
- Tests cover timeout-trigger auto-deny and auto-approve paths.
