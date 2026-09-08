# Algorithm selection

A model chooses an algorithm that passes small examples but exceeds comparison/resource bounds on larger inputs.

Decision: Choose a builder model/prompt capable of scalable algorithms.

Deterministic checks can grade a submitted candidate, but cannot establish whether the selected model will discover and produce that candidate. Runtime, task, and workflow invariants remain with their production owners.

Provenance: Synthetic scenario; no matching historical KOTA failure is claimed.

Run through explicit live evaluation or the configured weekly cadence. The fixture
manifest owns its time budget; the run report owns actual time, model usage, and
resource comparability. Calibration checks the scorer before any model call.
