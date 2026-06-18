---
id: task-stabilize-live-progress-reviewer-review-evidence-f
title: Stabilize live progress-reviewer review-evidence failures
status: ready
priority: p1
area: autonomy
summary: New progress-reviewer DLQ entries show review-evidence failing on timeout, writeScope attribution, and missing fenced JSON for workflow.batch.flushed runs. Add focused regression coverage or a redrive-backed fix so compact review packets complete, return schema-valid fenced JSON, and do not mutate tracked files outside .kota/runs/.
created_at: 2026-06-18T11:45:58.189Z
updated_at: 2026-06-18T11:45:58.189Z
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
