---
id: task-evaluator-calibration-drift-repair
title: Repair evaluator calibration drift
status: done
priority: p1
area: autonomy
summary: Restore the live-run evaluator calibration loop to within threshold by tightening critic guidance, repair-loop checks, or the calibration gate itself.
created_at: 2026-08-13T17:33:29.512Z
updated_at: 2026-08-13T18:32:17.000Z
---

## Problem

The live-run evaluator calibration gate fired in the last builder commit.
That signal turns into a typed `evaluator-calibration.regression.detected`
event and an attention-digest entry, but it must also turn into a concrete
repair: the critic, repair-loop checks, prompt guidance, or the gate
configuration itself need to change so the rate returns within threshold.

Drift kind(s): pass-contradiction.

Decision reason from the monitor:

> Pass-verdict contradiction rate 30.0% exceeds threshold 25.0% (3 of 10 pass verdicts).

## Calibration Snapshot

- Window: 2026-08-06T17:33:19.913Z → 2026-08-13T17:33:19.913Z
- Total runs in window: 15
- Pass verdicts: 10
- Pass-with-warnings verdicts: 0
- Fail verdicts: 1
- Absent verdicts: 4
- Pass-contradiction rate: 30.0% (3 of 10); threshold 25.0%.
- Pass-with-warnings follow-up rate: 0.0% (0 of 0); threshold 75.0%.

## Desired Outcome

Either:

- the underlying calibration drift is fixed (tighten critic guidance,
  introduce a sharper repair-loop check, raise the bar for accepted
  warnings, fix a prompt that lets the critic accept weak evidence); or
- the threshold is intentionally widened with a recorded reason (the
  current rate is the new healthy floor for the changed workload).

Either way, the next monitor run should land back at `under-threshold` or
`insufficient-sample` for the relevant kind, and that result must be
visible in the run artifact rather than only in attention digests.

## Constraints

- Keep critic input artifact-only (diff, repo state, run artifacts,
  optional runtime probe). Do not feed thinking traces or self-reports.
- Do not silence the gate by raising the threshold without a documented
  rationale committed alongside the threshold change.
- Keep operator-facing notification surfaces (attention digest) working —
  this task is in addition to that bridge, not instead of it.
- Do not add a parallel lessons store or audit surface.

## Done When

1. The drift kind named above is no longer firing on the last calibration
   sample, OR the gate config has been deliberately retuned with a
   recorded rationale.
2. Recent critic verdicts that were treated as `pass`/`pass_with_warnings`
   despite weak evidence have been re-classified by tighter guidance, a
   sharper repair-loop check, or follow-up tasks created for accepted
   trade-offs.
3. A run-directory artifact (`calibration-repair.json` or equivalent)
   shows the post-fix calibration aggregate moving back within threshold.

## Source / Intent

Auto-created by `evaluator-calibration-monitor` after the live calibration
gate fired at 2026-08-13T17:33:29.512Z. Replaces the previous notification-only
behavior so calibration drift becomes a deterministic next action in the
queue rather than a recurring attention item.

## Initiative

Autonomy execution quality: builder success should mean proven completion,
not only a clean commit with advisory caveats.

## Acceptance Evidence

- Test output for the calibration repair / critic classification fixtures.
- A monitor run-directory artifact showing the gate back within threshold,
  or the recorded rationale for retuning it.
- Updated scoped autonomy guidance naming which critic warning classes
  must fail, track follow-up, or pass as harmless.

## Outcome

The affected monitor snapshot remains exactly 15 runs, 10 passes, one fail,
four absent verdicts, and three contradictions (30%). The underlying run
artifacts were not preserved in this worktree, so this repair does not claim to
reclassify them. It records the low-sample overlap as an accepted trade-off and
opens `task-disposition-retained-evaluator-calibration-contrad` to recover the
three source identities and give every weak-evidence pass a durable disposition.
The pass minimum moves from 8 to 20 while the contradiction threshold remains
25%.

That retune is grounded in six Git-backed monitor task snapshots. The two
large windows contained 73–74 passes and held at 2.7%; the four 8–10-pass
windows swung from 30% to 44.4% because each overlap moved the rate by
10–12.5 points. Under the active config the unchanged affected aggregate is
therefore `insufficient-sample`, with an explicit rationale rather than a
lowered numerator or padded denominator.

The builder repair gate now rejects aggregate-only evidence. It resolves the
cited Git task revision, verifies every aggregate field against that
monitor-produced snapshot, requires it to be the claimed repair's latest
source, compares the candidate config with the same resolver the live monitor
uses, recomputes the gate decision, and requires at least two distinct prior
monitor snapshots for a retune. When the source aggregate contains weak-evidence
signals, the gate also requires a source-bound disposition and verifies that its
named follow-up exists in an open task state and covers the full signal count.
This closes the recent weak-evidence acceptance class without changing critic
input or resetting the prompt window.

Source-changing builder commits now request restart before emitting
`workflow.build.committed`. Restart synchronously pauses workflow dispatch, so
the handoff is persisted and consumed only after committed definitions load.
The runtime validator permits only pure emit handoffs after that restart
barrier, and still rejects code, agent, tool, or other executable work there.
A two-runtime integration test loads an old monitor before the barrier and a
new monitor after it; only the new definition consumes the queued handoff.

Every monitor evaluation writes a provenance-bearing
`calibration-repair.json`, including `under-threshold` and
`insufficient-sample` outcomes. The focused monitor fixture preserves all three
contradictions in the 10-pass affected shape and records
`insufficient-sample` under the 20-pass minimum.

Calibration artifacts also record source revision and retain the prompt hash
captured with the final verdict. Repair recreation uses revision lineage, so
the closing artifact and concurrent pre-fix branches cannot masquerade as a
post-repair evaluation; a genuine descendant regression can still reopen work.
The sourced retune artifact is registered at
`.kota/runs/2026-08-13T18-10-36-084Z-builder-dt3x45/evidence/artifacts/calibration-repair.json`.

## Validation Notes

The registered JSON test report records 102 passing calibration,
critic-classification, evidence-gate, lineage, restart, and structural tests.
The instruction-cap run also passed all 222 checks. Typecheck, build, task
validation, and all 29 workflow definitions pass; lint has 96 existing warnings.
