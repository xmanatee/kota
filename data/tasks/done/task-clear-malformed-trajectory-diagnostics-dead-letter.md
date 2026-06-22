---
id: task-clear-malformed-trajectory-diagnostics-dead-letter
title: Clear malformed trajectory diagnostics dead-letter
status: done
priority: p2
area: autonomy
summary: Resolved dlq-12b58bda-ee91-4362-b93a-7cf9a8ae07ae from trajectory-diagnostic-escalator rejecting .kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json by confirming current parser coverage for the legacy clean artifact and dismissing stale duplicate dead letters with durable evidence.
created_at: 2026-06-22T13:05:44.780Z
updated_at: 2026-06-22T14:37:24.441Z
---

## Problem

Resolve dlq-12b58bda-ee91-4362-b93a-7cf9a8ae07ae from trajectory-diagnostic-escalator rejecting .kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json. Either normalize the sample artifact to the expected schema or harden the escalator to skip/dismiss unsupported sample diagnostics, then redrive or dismiss the dead-letter with durable evidence.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T11-01-12-295Z-progress-reviewer-yapjt9.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T11-01-12-295Z-progress-reviewer-yapjt9.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 3, Meta 0, Unclassified 15. Recent autonomy/control-monitor work is landing, and the known progress-reviewer evidence-id dead-letter already has a ready task, but a newer trajectory-diagnostic dead-letter is open without a covering task.

Evidence ids:

- scope:8nrg1m:dead-letter:dlq-12b58bda-ee91-4362-b93a-7cf9a8ae07ae
- scope:8nrg1m:run:2026-06-22T13-02-54-631Z-trajectory-diagnostic-escalator-b8u03i
- scope:8nrg1m:artifact:2026-06-22T13-02-54-631Z-trajectory-diagnostic-escalator-b8u03i:error.txt

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-22T14-33-33-428Z-builder-kpya7t/dead-letter-resolution.md` records before/after state for dlq-12b58bda-ee91-4362-b93a-7cf9a8ae07ae, confirms there are zero open trajectory-diagnostic-escalator dead letters for `.kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json`, and cites focused parser/escalator tests proving the sample shape is handled as an empty observation.

## Completion Evidence

- `pnpm test src/modules/autonomy/trajectory-diagnostic-escalation.test.ts src/modules/autonomy/workflows/trajectory-diagnostic-escalator/workflow.test.ts` passed with 2 files and 17 tests.
- `pnpm kota workflow dlq show dlq-12b58bda-ee91-4362-b93a-7cf9a8ae07ae --json` reports `status: dismissed` and `dismissedAt: 2026-06-22T14:37:24.441Z`.
- `.kota/dead-letter-queue/items.json` now has zero open trajectory-diagnostic-escalator dead letters whose failure reason references `control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json`; the ten matching stale duplicates are dismissed.
