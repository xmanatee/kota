---
id: task-evaluator-calibration-drift-repair
title: Repair evaluator calibration drift
status: done
priority: p1
area: autonomy
summary: Restore the live-run evaluator calibration loop to within threshold by tightening critic guidance, repair-loop checks, or the calibration gate itself.
created_at: 2026-08-13T15:08:48.668Z
updated_at: 2026-08-13T16:06:36.633Z
---

## Problem

The live-run evaluator calibration gate fired in the last builder commit.
That signal turns into a typed `evaluator-calibration.regression.detected`
event and an attention-digest entry, but it must also turn into a concrete
repair: the critic, repair-loop checks, prompt guidance, or the gate
configuration itself need to change so the rate returns within threshold.

Drift kind(s): pass-contradiction.

Decision reason from the monitor:

> Pass-verdict contradiction rate 37.5% exceeds threshold 25.0% (3 of 8 pass verdicts).

## Calibration Snapshot

- Window: 2026-08-06T15:08:39.194Z → 2026-08-13T15:08:39.194Z
- Total runs in window: 13
- Pass verdicts: 8
- Pass-with-warnings verdicts: 0
- Fail verdicts: 1
- Absent verdicts: 4
- Pass-contradiction rate: 37.5% (3 of 8); threshold 25.0%.
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
gate fired at 2026-08-13T15:08:48.668Z. Replaces the previous notification-only
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

Repaired the stale verdict lifecycle without silencing the live
pass-contradiction gate or changing its 25% threshold. The critic clears its
prior verdict and scrutiny outcome before every retry, making an unavailable
final review honestly produce `absent`. The detector keeps its original
`verdict === "fail"` OR failed-terminal-run contract, and the builder terminal
finalizer now writes calibration for failed build steps before worktree cleanup;
the post-commit writer continues to cover successful runs.

The critic now treats evaluator signals reachable only in synthetic fixtures as
critical, intentionally resetting the prompt-hash sample. The live CLI reports
`insufficient-sample` with 0 fresh runs under prompt `a9c80b96e38f`, while a
production-shaped test creates a failed builder artifact through the terminal
writer and proves it contradicts an earlier overlapping pass. Calibration
artifact writing, aggregation, and public types remain split into focused
modules without a severe source-size batch. Evidence is registered as
`.kota/runs/2026-08-13T15-36-07-327Z-builder-ed267r/evidence/artifacts/calibration-repair.json`;
the final focused set passed 61 tests, 34 related tests passed, and lint,
typecheck, build, task validation, and all 29 workflow definitions passed.
