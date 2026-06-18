---
id: task-stabilize-live-progress-reviewer-review-evidence-f
title: Stabilize live progress-reviewer review-evidence failures
status: done
priority: p1
area: autonomy
summary: New progress-reviewer DLQ entries show review-evidence failing on timeout, writeScope attribution, and missing fenced JSON for workflow.batch.flushed runs. Add focused regression coverage or a redrive-backed fix so compact review packets complete, return schema-valid fenced JSON, and do not mutate tracked files outside .kota/runs/.
created_at: 2026-06-18T11:45:58.189Z
updated_at: 2026-06-18T12:16:38.997Z
---

## Problem

New progress-reviewer DLQ entries show review-evidence failing on timeout, writeScope attribution, and missing fenced JSON for workflow.batch.flushed runs. Add focused regression coverage or a redrive-backed fix so compact review packets complete, return schema-valid fenced JSON, and do not mutate tracked files outside .kota/runs/.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-17T16-52-58-038Z-progress-reviewer-k2nq7w.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Resolution

The cited progress-reviewer DLQ failures were closed after verifying both the
code-level repair and a later live same-shape progress-reviewer run. Commit
`17fcf0b84042` added fenced-JSON guidance for `review-evidence`, dirty-worktree
gating before the agent step, and focused regression coverage for large
`workflow.batch.flushed` run-count packets. Live run
`2026-06-18T11-40-28-197Z-progress-reviewer-p5jcqu` then completed
`review-evidence` successfully in 144475 ms for a `workflow.batch.flushed`
count packet, produced decoded schema-valid JSON, and created no write-scope
violation artifact.

The three cited DLQ items were dismissed with the recorded rationale that their
old run-trigger payloads were superseded by the successful same-shape run and
that redriving them would duplicate stale evidence.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-17T16-52-58-038Z-progress-reviewer-k2nq7w.

review verdict: needs-steering
review summary: The recovery-triggered batch completed, but scope health is not on track: the packet shows 16 open dead-letter items with no redrives, including new progress-reviewer review-evidence failures for timeout, writeScope attribution, and missing fenced JSON.

Evidence ids:

- run:2026-06-17T16-52-56-769Z-progress-reviewer-omn66k
- dead-letter:dlq-1768ef43-3b90-4302-925a-19e664aef676
- dead-letter:dlq-66558e40-802a-453f-9f78-d59b9cc37409
- dead-letter:dlq-ef5f8a27-1b5e-43a6-b56e-3553eb7c934a

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A focused progress-reviewer workflow test or redrive artifact under .kota/runs/ showing review-evidence completes with schema-valid fenced JSON, no writeScope violation, and the cited progress-reviewer DLQ items are redriven or dismissed with rationale.
- `.kota/runs/2026-06-18T12-07-51-539Z-builder-8o0dai/dead-letter-resolution.md` records the original failures, dismissal rationale, live same-shape run evidence, post-state, and validation.
- `.kota/runs/2026-06-18T12-07-51-539Z-builder-8o0dai/dlq-1768ef43-before-dismissal.json`, `dlq-66558e40-before-dismissal.json`, and `dlq-ef5f8a27-before-dismissal.json` preserve the original open diagnostics.
- `.kota/runs/2026-06-18T12-07-51-539Z-builder-8o0dai/dlq-1768ef43-after-dismissal.json`, `dlq-66558e40-after-dismissal.json`, and `dlq-ef5f8a27-after-dismissal.json` record status `dismissed`, `dismissedAt`, and the shared dismissal reason.
- `pnpm dev workflow dlq list --json --status open --workflow progress-reviewer` returned `items: []`.
- `pnpm test src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts src/core/workflow/steps/agent-write-scope.test.ts` passed: 2 files, 47 tests.
- `pnpm validate-tasks` passed.
