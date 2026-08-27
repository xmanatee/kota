---
status: open
priority: p1
---

# Disposition retained evaluator calibration contradictions

## Problem

The 2026-08-13 evaluator-calibration repair snapshot retained three
`pass` verdicts that were contradicted by later overlapping terminal failure.
Only the aggregate survived into the Git-backed repair task; the run-level
artifacts needed to identify and re-review those verdicts were not projected
into the builder run. Treating the three signals as anonymous statistical
noise leaves their weak-evidence disposition unauditable.

## Desired Outcome

Calibration drift evidence identifies every contradictory verdict and its
overlapping follow-up. The three retained signals from the cited source receive
durable individual dispositions: reclassified critic verdict, accepted overlap
with rationale, or a concrete corrective task tied to the affected code/task.

## Constraints

- Keep critic inputs artifact-only; do not add self-reports or thinking traces.
- Do not mutate historical critic verdict artifacts in place. Add a typed
  disposition linked to the immutable source run and revision.
- Preserve aggregate rates as derived values; do not pad or rewrite the sample.

## Done When

1. Calibration aggregation exposes the base run id, later run id/failure,
   overlapping source paths, task id, and source revisions for each counted
   contradiction without changing the existing aggregate counts.
2. The three weak-evidence passes in the cited 3-of-10 source snapshot each
   have a durable disposition, or an explicit source-unavailable record proves
   why an identity cannot be recovered from the canonical run store.
3. Monitor/repair artifacts carry those identities and dispositions into the
   isolated writer run, with focused fixtures proving no unrelated overlap is included.

## Calibration Source

sourceRef: git:13b6ff71513809651ad43cbc2bd3a23a422abf8c:data/tasks/task-evaluator-calibration-drift-repair.md
weakEvidenceCount: 3
acceptedTradeoff: low-sample-overlap

## Source / Intent

Created as the explicit accepted-trade-off disposition required by Done When 2
of `task-evaluator-calibration-drift-repair`. That repair deliberately treats
the 10-pass window as statistically insufficient but does not claim the three
historical passes were sound; this task preserves the obligation to identify
and disposition them once canonical run evidence is projected.

## Initiative

Autonomy execution quality: builder success should mean proven completion,
and evaluator retunes must not erase the weak verdicts that triggered them.

## Acceptance Evidence

- Focused evaluator-calibration aggregate and monitor fixture output.
- A projected JSON disposition artifact enumerating the three source signals
  or recording source-unavailable evidence for any unrecoverable identity.
