---
id: task-clear-malformed-trajectory-diagnostics-dead-letter
title: Clear malformed trajectory diagnostics dead-letter
status: ready
priority: p2
area: autonomy
summary: Resolve dlq-12b58bda-ee91-4362-b93a-7cf9a8ae07ae from trajectory-diagnostic-escalator rejecting .kota/runs/control-monitor-coverage-gap-sample/steps/build.trajectory-diagnostics.json. Either normalize the sample artifact to the expected schema or harden the escalator to skip/dismiss unsupported sample diagnostics, then redrive or dismiss the dead-letter with durable evidence.
created_at: 2026-06-22T13:05:44.780Z
updated_at: 2026-06-22T13:05:44.780Z
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

- A run artifact records before/after state for dlq-12b58bda-ee91-4362-b93a-7cf9a8ae07ae, shows no open trajectory-diagnostic-escalator dead-letter for the sample artifact, and includes either a focused parser/escalator test or a redrive transcript proving the same artifact no longer dead-letters.
