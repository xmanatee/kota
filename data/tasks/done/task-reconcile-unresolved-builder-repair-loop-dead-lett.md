---
id: task-reconcile-unresolved-builder-repair-loop-dead-lett
title: Reconcile unresolved builder repair-loop dead letters
status: done
priority: p1
area: autonomy
task_class: Meta
summary: Investigate the two open builder dispatch failures involving source-file-size-severe and success-criteria-declared/commit-stageable checks. Determine whether each originating build remains actionable, then redrive it successfully or dismiss it with a durable, evidence-backed rationale.
created_at: 2026-08-03T08:40:56.535Z
updated_at: 2026-08-03T13:19:16.735Z
---

## Problem

    Investigate the two open builder dispatch failures involving source-file-size-severe and success-criteria-declared/commit-stageable checks. Determine whether each originating build remains actionable, then redrive it successfully or dismiss it with a durable, evidence-backed rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-03T07-59-27-634Z-progress-reviewer-yqdirz.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-03T07-59-27-634Z-progress-reviewer-yqdirz.

review verdict: needs-steering
review summary:

    Directory scope kota (scopeId 8nrg1m); task-count review triggered by workflow.batch.flushed for the 2026-08-02T08:39:18.082Z–2026-08-03T08:39:18.082Z window. Included 20 runs, 4 tasks, 1 event, 40 artifacts, 60 git entries, and 5 open dead letters. Task balance was Safety 3, Meta 1, Product 0, Platform 0. The operator-token-path safety fix reached done and emitted a build-committed event, but workflow reliability needs steering: the latest improver failed and five dead letters remain open across builder, improver, and progress-reviewer. Payload bodies for 132 policy-pruned run references were unavailable; runs, artifacts, git entries, and large commit file lists were truncated as recorded in the packet. Applied actions: no direct mutations; one local follow-up is proposed for unresolved builder dead letters, while the existing ready repair task already covers the improver failure pattern. No owner decision is required.

Evidence ids:

- dead-letter:dlq-4cb22bbd-5ea3-4b9c-9686-816b007d4bb4
- dead-letter:dlq-56113570-bc5a-4844-a2b0-6d9c045cac72

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    Both cited builder dead letters have a recorded final disposition; any still-valid originating task is successfully redriven or restored to an actionable queue state; and focused regression evidence demonstrates that the relevant repair checks either progress toward resolution or terminate with an actionable diagnosis.

## Resolution Evidence

- `dlq-4cb22bbd-5ea3-4b9c-9686-816b007d4bb4` was redriven; its web-client
  source task completed in commit `47c9da54f` with the rendered evidence named
  by that task.
- `dlq-56113570-bc5a-4844-a2b0-6d9c045cac72` was dismissed. Its successor
  aggregate `dlq-63e95b56-e9cc-4cc4-91f6-3726655c5afb` was dismissed after
  reviewed decomposer run
  `2026-08-03T13-14-23-877Z-decomposer-fpogq2` retired the repeatedly failing
  source into three actionable Safety tasks in commit `0f5304185`.
- `decomposer-agent-call-replay` passed three of three production workflow
  replays with both `pass@k` and `pass^k` at 100% in eval artifact
  `.kota/eval-runs/2026-08-03T13-13-56-455Z/eval-set-report.json`.
