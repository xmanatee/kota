---
id: task-throttle-no-action-scope-improver-file-change-runs
title: Throttle no-action scope-improver file-change runs
status: done
priority: p2
area: autonomy
summary: During the 2026-06-19 builder edit burst, file-watch scope-improver runs repeated within minutes with a dirty worktree, skipped recommendations, and zero created tasks, owner questions, edits, or commits. Make no-action or dirty-file-change scope-improver outcomes update cooldown/dedupe state or suppress attention so active builders do not generate repeated zero-value runs.
created_at: 2026-06-19T06:48:27.377Z
updated_at: 2026-06-19T07:41:33.638Z
---

## Problem

During the 2026-06-19 builder edit burst, file-watch scope-improver runs repeated within minutes with a dirty worktree, skipped recommendations, and zero created tasks, owner questions, edits, or commits. Make no-action or dirty-file-change scope-improver outcomes update cooldown/dedupe state or suppress attention so active builders do not generate repeated zero-value runs.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-19T06-42-03-273Z-progress-reviewer-dn0d4a.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-19T06-42-03-273Z-progress-reviewer-dn0d4a.

review verdict: needs-steering
review summary: Window balance: Product 7, Platform 2, Meta 1, Unclassified 10. Product/client work is landing with evidence, and the peer-benchmark operator-risk is covered by committed transcript evidence, but repeated zero-action scope-improver runs during an active builder edit burst need a bounded autonomy follow-up.

Evidence ids:

- run:2026-06-19T06-25-06-077Z-scope-improver-z9dsv9
- run:2026-06-19T06-25-18-824Z-scope-improver-cyjbit
- run:2026-06-19T06-26-39-325Z-scope-improver-gh9dy9
- run:2026-06-19T06-27-03-115Z-scope-improver-hn2vdo
- run:2026-06-19T06-28-22-173Z-scope-improver-cqu45q
- run:2026-06-19T06-30-05-181Z-scope-improver-39vlcc
- run:2026-06-19T06-34-57-686Z-scope-improver-zz1m55
- run:2026-06-19T06-35-49-662Z-scope-improver-4ytkci
- run:2026-06-19T06-36-50-421Z-scope-improver-74zkfk
- run:2026-06-19T06-42-01-180Z-scope-improver-uyj2ht

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused scope-improver tests cover a dirty files.changed burst and a skip-only candidate burst, proving no more than one zero-action attention item within minMinutesBetweenRuns while a later actionable candidate still runs; include a run artifact or fixture showing the throttle/dedupe decision.
- Implemented evidence: scope-improver now records cooldown for non-throttled zero-action runs that never reach apply-recommendations, does not slide the cooldown on already-throttled runs, and emits workflow.attention.digest only for visible actions.
- Validation: `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/autonomy/workflows/scope-improver/workflow.test.ts` passed with 13 tests.
- Run artifact: `.kota/runs/2026-06-19T07-32-53-546Z-builder-kuhf75/scope-improver-throttle-evidence.json`.
