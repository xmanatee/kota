# Evaluator authoring

A model writes an always-pass evaluator or prose instead of detecting refund-trace violations.

Decision: Choose models/prompts for focused executable evaluator authoring.

Deterministic checks can grade a submitted candidate, but cannot establish whether the selected model will discover and produce that candidate. Runtime, task, and workflow invariants remain with their production owners.

Provenance: Synthetic scenario; no matching historical KOTA failure is claimed.

Run through explicit live evaluation or the configured weekly cadence. The fixture
manifest owns its time budget; the run report owns actual time, model usage, and
resource comparability. Calibration checks the scorer before any model call.

The scorer executes candidates against runner variations with unchanged case
labels. Repaired traces, missing calls, mismatched order IDs, and email leaks
must change the observed verdicts. Constant-result fabrication is the adversarial
calibration case. This measures trace-sensitive evaluator behavior, not a
self-reported account of how the evaluator was written.
