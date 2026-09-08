# Semantic task normalization

A model creates duplicate work instead of recognizing an existing semantically equivalent task.

Decision: Choose inbox-sorter prompts/models for semantic deduplication.

Deterministic checks can grade a submitted candidate, but cannot establish whether the selected model will discover and produce that candidate. Runtime, task, and workflow invariants remain with their production owners.

Provenance: 2026-04-15T21-20-03-042Z-inbox-sorter-j7lclg

Run through explicit live evaluation or the configured weekly cadence. The fixture
manifest owns its time budget; the run report owns actual time, model usage, and
resource comparability. Calibration checks the scorer before any model call.
