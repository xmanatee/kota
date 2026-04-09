---
id: task-approval-step-operator-notes
title: Let operators attach notes when approving workflow steps
status: done
priority: p2
area: operator-ux
summary: Approval step resolutions are binary (approve/reject) with no way to pass guidance. Operators who want to approve with caveats must wait for the next human-in-the-loop touchpoint. Adding an optional notes field to approval responses would surface operator intent to the next agent step.
created_at: 2026-04-02T05:06:00Z
updated_at: 2026-04-02T05:06:00Z
---

## Problem

The current approval step is binary: the operator approves or rejects, and the workflow resumes
or stops. There is no channel for the operator to attach guidance alongside their decision — for
example "approved, but please also add a unit test" or "approved, but ensure the PR description
covers the breaking change."

When the operator wants to steer the next agent step, they must either wait until the run
completes and start a new session, or (if no follow-up is queued) have no way to inject intent
at all. This reduces the value of human-in-the-loop approval gates for teams that want advisory
oversight, not just a stop/go gate.

## Desired Outcome

Operators can attach an optional text note when approving a workflow step. The note is:

- Collected via the approval CLI (`kota approval approve <id> --note "..."`) and stored on the
  approval queue record.
- Surfaced in the approval step's output object as `approvalNote?: string`.
- Available in subsequent agent step prompts via the existing step output injection mechanism,
  so the builder can read and act on the guidance without special-case logic.
- Displayed in the web UI Approvals panel alongside the approval record for audit purposes.

Rejection notes are already supported via `--reason`. This task adds a parallel `--note` path
for the approved case.

## Constraints

- The note is optional on both sides: no change to approval flows that omit it.
- Store the note on the existing `ApprovalQueueEntry` record — no new persistent table.
- The CLI approval approve command already accepts `--reason` for rejections; add `--note`
  symmetrically without changing the rejection path.
- Builder's agent step prompt injection uses the existing `shareOutput: true` mechanism on the
  approval step — no new step type or prompt template changes needed beyond surfacing the field.
- The web UI Approvals panel should display the note when present; no redesign required.

## Done When

- `kota approval approve <id> --note "<text>"` stores the note on the approval record.
- The approval step output includes `approvalNote: string` when a note was provided.
- Agent steps following an approval step with `shareOutput: true` receive the note in their
  context prompt.
- Web UI Approvals panel renders the note text alongside resolved approvals.
- Existing approval CLI tests pass; new tests cover note capture and output propagation.
