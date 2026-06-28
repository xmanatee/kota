---
id: task-add-observability-evidence-for-approve-all-queue-f
title: Add observability evidence for approve-all queue fix
status: ready
priority: p2
area: approval-queue
summary: The approve-all race fix landed with changes to src/core/daemon/approval-queue.ts, but the builder diagnostic reported missing observability evidence and a source-size advisory for that runtime-sensitive file.
created_at: 2026-06-28T13:11:09.686Z
updated_at: 2026-06-28T13:11:09.686Z
---

## Problem

The approve-all race fix landed with changes to src/core/daemon/approval-queue.ts, but the builder diagnostic reported missing observability evidence and a source-size advisory for that runtime-sensitive file.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 1, Safety 1, Platform 1, Meta 0, Unclassified 6. Product and security work landed with no operator-journey risk, but the latest builder committed one task while holding another claim, failed only after commit, and the scope still has open dead letters.

Evidence ids:

- run:2026-06-28T12-36-26-477Z-builder-hd8dph
- git:commit:a0cd7bee2005
- task:task-security-review-the-approve-all-control-path-prefl

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up run artifact or focused test maps src/core/daemon/approval-queue.ts to inspectable observability evidence or an explicit rationale, the source-size advisory is resolved or justified, focused approval-queue tests pass, and task validation passes.
