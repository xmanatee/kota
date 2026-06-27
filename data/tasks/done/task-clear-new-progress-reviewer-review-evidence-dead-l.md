---
id: task-clear-new-progress-reviewer-review-evidence-dead-l
title: Clear new progress-reviewer review-evidence dead letters
status: done
priority: p2
area: autonomy
summary: Resolve the two open progress-reviewer workflow-dispatch DLQs for review-evidence timeout and codex_cli_error stream disconnect. Preserve before/after diagnostics, decide whether the failed batches are still meaningful, then redrive or dismiss with durable rationale.
created_at: 2026-06-26T14:55:51.497Z
updated_at: 2026-06-27T03:42:26.237Z
---

## Problem

Resolve the two open progress-reviewer workflow-dispatch DLQs for review-evidence timeout and codex_cli_error stream disconnect. Preserve before/after diagnostics, decide whether the failed batches are still meaningful, then redrive or dismiss with durable rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-26T14-51-12-390Z-progress-reviewer-m5xqqb.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-26T14-51-12-390Z-progress-reviewer-m5xqqb.

review verdict: needs-steering
review summary: Needs steering: balance is Product 2, Safety 2, Platform 11, Meta 1, Unclassified 4. The latest Platform builder work and post-build monitors are healthy, but two new open progress-reviewer review-evidence dead letters remain after the prior DLQ cleanup.

Evidence ids:

- dead-letter:dlq-87d8b051-5f99-48d3-8983-7306c3d103bd
- dead-letter:dlq-928f95fe-28e3-478c-baa5-3a5d9bc4e5a0
- task:task-resolve-current-workflow-dead-letters

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A run artifact records before/after DLQ state for both cited ids, the redrive or dismissal rationale, same-shape progress-reviewer review-evidence success within the step timeout, and a no-open-progress-reviewer-DLQ check.
- `.kota/runs/2026-06-27T03-25-12-240Z-builder-ztdxh1/dlq-87d8b051-before.json` and `.kota/runs/2026-06-27T03-25-12-240Z-builder-ztdxh1/dlq-928f95fe-before.json` preserve the original open DLQ diagnostics.
- `.kota/runs/2026-06-27T03-25-12-240Z-builder-ztdxh1/dlq-87d8b051-after.json` and `.kota/runs/2026-06-27T03-25-12-240Z-builder-ztdxh1/dlq-928f95fe-after.json` record both items dismissed with durable rationale.
- `.kota/runs/2026-06-27T03-25-12-240Z-builder-ztdxh1/dlq-resolution.md` records the dismissal decision, live run-count success (`review-evidence` completed in 241433ms in `2026-06-26T14-51-12-390Z-progress-reviewer-m5xqqb`), focused run-count and task-count regression checks, and the no-open-progress-reviewer-DLQ check.
