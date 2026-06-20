---
id: task-split-oversized-security-review-workflow-test
title: Split oversized security-review workflow test
status: ready
priority: p3
area: autonomy
summary: The latest security-review fix completed but emitted a source-file-size warning because src/modules/autonomy/workflows/security-review/workflow.test.ts is over the source-size guideline after the new regressions. Split repeated setup, fixtures, or focused cases into smaller co-located test/helper files while preserving the confirmed-finding regressions.
created_at: 2026-06-20T02:31:27.976Z
updated_at: 2026-06-20T02:31:27.976Z
---

## Problem

The latest security-review fix completed but emitted a source-file-size warning because src/modules/autonomy/workflows/security-review/workflow.test.ts is over the source-size guideline after the new regressions. Split repeated setup, fixtures, or focused cases into smaller co-located test/helper files while preserving the confirmed-finding regressions.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-20T02-28-10-014Z-progress-reviewer-2fbx6f.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-20T02-28-10-014Z-progress-reviewer-2fbx6f.

review verdict: needs-steering
review summary: Kota is progressing but still needs steering: Product 0, Safety 2, Platform 7, Meta 2, Unclassified 9. The three build-commit batch closed the two refactor tasks and the terminal-task security finding, but one owner/setup question remains pending and the latest security fix surfaced an oversized security-review workflow test file needing a narrow follow-up.

Evidence ids:

- run:2026-06-20T02-18-06-447Z-builder-620mjn
- git:commit:272b868faeb8:file:4
- task:task-refactor-oversized-builder-and-security-review-wor

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Record before/after line counts for src/modules/autonomy/workflows/security-review/workflow.test.ts, keep extracted helpers co-located under the security-review workflow, and pass NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/autonomy/workflows/security-review/workflow.test.ts plus pnpm typecheck.
