---
status: done
---

# Ensure security-review due targets survive candidate capping

## Problem

The 2026-06-29 security-review run ended no-op, but its scan artifact reported due targets missed because the candidate cap was reached. Due security-review targets should be prioritized or explicitly reported as skipped before a no-findings outcome is recorded.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T23-00-00-007Z-progress-reviewer-hkn1fd.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T23-00-00-007Z-progress-reviewer-hkn1fd.

review verdict: needs-steering
review summary: Mostly healthy KOTA progress with one narrow security-review coverage gap. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 15. The window closed security and platform follow-ups with no open dead letters or operator-journey risks, but the latest security-review no-op missed due targets behind candidate capping.

Evidence ids:

- scope:8nrg1m:run:2026-06-29T00-21-24-444Z-security-review-pn7qxo

## Initiative

Outcome-aware autonomy progress review.

## Result

The scanner now takes one representative candidate for each available due target before applying generic per-surface filling. This fixes the cited per-surface cap miss without hiding unavoidable hard global-cap misses, which remain explicit `candidate-cap` diagnostics.

## Acceptance Evidence

- Focused test: `pnpm test src/modules/autonomy/workflows/security-review/workflow.test.ts` passed with 20 tests.
- Replay artifact: `.kota/runs/2026-06-29T00-54-05-074Z-builder-wxfnfp/security-review-due-target-replay.json` replays `scope:8nrg1m:run:2026-06-29T00-21-24-444Z-security-review-pn7qxo` and reports `dueTargetTotal: 9`, `dueTargetMatched: 9`, `dueTargetMissed: 0`, and `candidateCapMissCount: 0`.
- Task validation transcript: `.kota/runs/2026-06-29T00-54-05-074Z-builder-wxfnfp/validate-tasks.txt` records `pnpm validate-tasks` passing after the staged task move.
