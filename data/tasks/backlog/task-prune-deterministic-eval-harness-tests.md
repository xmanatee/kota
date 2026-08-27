---
id: task-prune-deterministic-eval-harness-tests
title: Remove deterministic duplication from the eval harness
status: backlog
priority: p1
area: eval-harness
summary: Retain eval assets only for model-dependent capability, realistic trajectories, and historical agent failures that deterministic owners cannot represent.
task_class: Meta
depends_on: [task-align-verification-ownership-and-cadences, task-migrate-autonomy-workflow-families]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Scope / Starting Points

Inventory every fixture, recording, copied repository, scorer, calibration case, replay format, compatibility reader, smoke gate, and test under `src/modules/eval-harness` plus eval cadence wiring.

## Required Changes

- For each asset record the model-dependent failure or realistic trajectory, historical regression if any, decision informed, cadence, cost, and deterministic-owner alternative.
- Retain agent capability for weak-model behavior, planning, research, tool use, and multi-step coding only when deterministic proof is insufficient.
- Move deterministic product, runtime, workflow, and protocol behavior to its production owner.
- Delete obsolete copied repositories, recordings, scorers, compatibility replay readers, and support code rather than archiving them indefinitely.
- Keep scorers outcome-oriented and independent of hidden reasoning or exact implementation paths.

## Must Not Complete While

Any eval asset is unclassified, any retained asset lacks a decision and model-dependent failure, deterministic checks have merely moved into fixture data, or an obsolete format remains supported without a current fixture.

## Done When

The asset inventory has zero unresolved rows; every retained eval names why deterministic proof is insufficient; all deleted assets and their final support consumers are removed; cadence membership and cost match the verification standard.

## Acceptance Evidence

Provide the asset/capability/decision/cadence/disposition matrix and before/after executable-eval, authored-fixture, scorer, and support LOC.

## Initiative

Lean behavioral verification: evals measure agent capability, not a second deterministic product specification.
