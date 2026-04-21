# Calibrate live evaluator follow-up signal

The live evaluator-calibration signal may overcount normal iteration as critic
failure.

Evidence:
- `aggregateCalibration()` treats any later builder run touching the same source
  file within the follow-up window as a contradiction for a prior `pass`.
- The current autonomy pattern intentionally performs chains of related
  core-shrink commits that touch the same module repeatedly.
- The gate comment says the critic passed a run that did not reach terminal
  success, but the implementation actually measures later overlapping edits.

Desired direction:
- Rename or reshape the metric so it represents what it actually measures.
- Consider requiring stronger evidence for contradiction, such as a failed later
  run, a task explicitly repairing the prior run, or a critic/regression artifact
  that names the previous work.
- Keep the monitor useful without training autonomy to avoid healthy iterative
  refactors.

