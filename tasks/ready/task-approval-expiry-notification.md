---
id: task-approval-expiry-notification
title: Notify operator via channel when approval step auto-resolves on timeout
status: ready
priority: p2
area: runtime
summary: When an approval step's timeoutMs elapses and defaultResolution fires, no channel notification is sent. Operators learn of the auto-resolution only by checking run status after the fact, which creates a silent operational gap.
created_at: 2026-04-08T18:02:39Z
updated_at: 2026-04-08T18:02:39Z
---

## Problem

Approval steps support `timeoutMs` and `defaultResolution: "deny" | "approve"`. When the
timeout fires, the run either fails or continues — but no channel notification is emitted.
Operators who are not actively watching `kota workflow logs` or the web UI have no way to
know that a pending approval silently auto-resolved. A run may fail (or dangerously
auto-approve) while the operator is unaware that any approval was ever pending.

The existing `workflow.failure.alert` event fires after the run fails, but that event
carries no information about why the run failed or that an approval timeout was the cause.

## Desired Outcome

When an approval step auto-resolves due to timeout, the daemon emits a notification that:

- Identifies the workflow and run by name and ID.
- States which approval step timed out and how it resolved (`auto-approved` or `auto-denied`).
- Includes the step's `reason` field if present.
- Is delivered via all configured notification channels (same path as `workflow.failure.alert`).

A new event type (e.g., `workflow.approval.expired`) on the event bus carries this payload.
Notification extensions subscribe to it using the same pattern as existing alert events.
The event is emitted from the approval step executor immediately when `defaultResolution` fires,
before the run outcome is recorded.

## Constraints

- Only affects steps where `timeoutMs` and `defaultResolution` are explicitly set; steps
  without a timeout do not emit this event.
- If `notify.onApprovalExpiry: false` is added to a workflow's `notify` block (see
  task-per-workflow-notification-filter), that flag should suppress this event.
- No changes to manual approval resolution paths — this only covers timeout auto-resolution.
- The new event payload should include: `workflowName`, `runId`, `stepId`, `resolution`
  ("approve" | "deny"), `reason` (optional string from the step definition).

## Done When

- `workflow.approval.expired` event is emitted when an approval step auto-resolves.
- Notification extensions receive and deliver the event to configured channels.
- A unit test covers: event emitted on timeout resolution, not emitted on manual resolution.
- `docs/DAEMON-API.md` or `docs/WORKFLOWS.md` documents the new event type and payload.
