---
id: task-evaluator-calibration-drift-repair
title: Repair evaluator calibration drift
status: ready
priority: p1
area: autonomy
summary: Restore the live-run evaluator calibration loop to within threshold by tightening critic guidance, repair-loop checks, or the calibration gate itself.
created_at: 2026-05-02T16:30:52.081Z
updated_at: 2026-05-02T16:30:52.081Z
---

## Problem

The live-run evaluator calibration gate fired in the last builder commit.
That signal turns into a typed `evaluator-calibration.regression.detected`
event and an attention-digest entry, but it must also turn into a concrete
repair: the critic, repair-loop checks, prompt guidance, or the gate
configuration itself need to change so the rate returns within threshold.

Drift kind(s): pass-contradiction, pass-with-warnings-escalation.

Decision reason from the monitor:

> Pass-verdict contradiction rate 61.9% exceeds threshold 25.0% (60 of 97 pass verdicts). Pass-with-warnings follow-up rate 95.0% exceeds threshold 40.0% (19 of 20 pass_with_warnings verdicts).

## Calibration Snapshot

- Window: 2026-04-25T16:30:51.789Z → 2026-05-02T16:30:51.789Z
- Total runs in window: 118
- Pass verdicts: 97
- Pass-with-warnings verdicts: 20
- Fail verdicts: 0
- Absent verdicts: 1
- Pass-contradiction rate: 61.9% (60 of 97); threshold 25.0%.
- Pass-with-warnings follow-up rate: 95.0% (19 of 20); threshold 40.0%.

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
gate fired at 2026-05-02T16:30:52.081Z. Replaces the previous notification-only
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
