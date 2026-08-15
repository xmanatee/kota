---
id: task-terminally-disposition-the-four-residual-workflow
title: Terminally disposition the four residual workflow-dispatch dead letters
status: blocked
priority: p2
area: platform
task_class: Platform
summary: After the existing stale-claim recovery task resolves its two explicitly cited dead letters, reconcile the four remaining open items covering the original builder and improver resumeSessionId failures, the transient 503, and the unreadable-fixture EACCES failure. Preserve claim and worktree recovery ownership in the existing task rather than duplicating it.
created_at: 2026-08-13T17:38:05.815Z
updated_at: 2026-08-15T16:31:00.000Z
---

## Problem

    After the existing stale-claim recovery task resolves its two explicitly cited dead letters, reconcile the four remaining open items covering the original builder and improver resumeSessionId failures, the transient 503, and the unreadable-fixture EACCES failure. Preserve claim and worktree recovery ownership in the existing task rather than duplicating it.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-13T15-35-39-434Z-progress-reviewer-zckkp0.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-13T15-35-39-434Z-progress-reviewer-zckkp0.

review verdict: needs-steering
review summary:

    Directory scope 8nrg1m/kota, run-count trigger, covering 2026-08-12T17:34:00.820Z–2026-08-13T17:34:00.820Z. Included 20 runs, 13 tasks, 30 events, 40 artifacts, 60 git references, 6 open dead letters, and 169 evidence items. Excluded 1,228 policy-pruned run payloads, older runs and events beyond their limits, artifacts and git entries beyond their limits, truncated changed-file lists, and 79 lower-detail prompt references. Task balance is Product 0, Safety 1, Platform 6, Meta 5, and Unclassified 1. Keychain isolation and recovery of the failed builder work are proven, but evaluator pass-contradiction remains above threshold, two high-priority tasks remain behind stale claims, and six dispatch dead letters remain open. Review action: propose one non-duplicate P2 task for the four residual dead letters not explicitly owned by the existing stale-claim recovery task; no owner decision is required.

Evidence ids:

- task:task-recover-the-two-stale-builder-claims-blocking-high
- dead-letter:dlq-263574f1-cd0d-4369-a818-8050cae6d16e
- dead-letter:dlq-f084687d-a51d-4ebd-aba7-574d9ac57ae6
- dead-letter:dlq-69a4e56a-2119-4b30-b661-aa07517a4d83
- dead-letter:dlq-ee8ffaa1-ea74-4d68-816d-768c8101b0b7
- git:commit:0d25cce60706
- run:2026-08-13T15-23-00-393Z-builder-bi8nab

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A run artifact maps each of the four residual dead-letter ids to its source run, superseding evidence, and redrive-or-dismiss decision; the existing recovery task remains the sole owner of its two cited claim-linked items; the resulting projection contains none of the original six open items; no unique claim or worktree changes are lost; and focused dead-letter/state-recovery tests plus task validation pass.
## Status (2026-08-15 builder)

The four residual records have evidence-backed terminal dismissal decisions in registered builder artifact `dead-letter-host-replay.json`. The isolated worktree correctly exposes neither the canonical directory-scope DLQ nor its recovery projection, so this run made no canonical DLQ, claim, or worktree mutation. A trusted host must verify each exact source-run guard, apply or confirm the four dismissals, and capture the six-id open-state projection. The existing recovery task remains the sole owner of the two claim-linked records and their unique-work preservation proof.

## Status (2026-08-15 host verification)

Host replay stopped before mutation because the packet does not satisfy its own source-run guard. Canonical record `dlq-ee8ffaa1-ea74-4d68-816d-768c8101b0b7` belongs to workflow `builder` and failed run `2026-08-13T10-23-52-461Z-builder-pmbg6e`; the packet maps it to workflow `improver` and nonexistent source run `2026-08-13T13-18-45-672Z-improver-36d1kf`. No residual dead letter was dismissed. Correct and revalidate that exact mapping against the canonical record before requesting another host replay; do not weaken the guard or substitute a different item.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-08-15T12-02-42-000Z-dead-letter-terminal-disposition-host/verification.json
description: trusted canonical-host capture that verifies and terminally dismisses the four residual dead-letter ids using the registered replay packet, proves none of the original six ids remains open, cites task-recover-the-two-stale-builder-claims-blocking-high as sole owner of the two claim-linked items, and confirms no unique claim or worktree changes were lost
```
