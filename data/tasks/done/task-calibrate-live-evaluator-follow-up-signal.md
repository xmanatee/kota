---
id: task-calibrate-live-evaluator-follow-up-signal
title: Calibrate live evaluator follow-up signal
status: done
priority: p2
area: eval-harness
summary: Reshape aggregateCalibration contradiction metric so chains of related core-shrink edits don't inflate critic-failure counts
created_at: 2026-04-21T15:50:58.809Z
updated_at: 2026-04-21T16:56:13.809Z
---

## Problem

The live evaluator-calibration signal can overcount healthy iteration as critic
failure.

- `aggregateCalibration()` treats any later builder run touching the same
  source file within the follow-up window as a contradiction of a prior
  critic `pass`.
- Autonomy intentionally performs chains of related core-shrink commits that
  touch the same module repeatedly, so overlap alone is a weak contradiction
  signal.
- The gate comment says the critic passed a run that did not reach terminal
  success, but the implementation actually measures later overlapping edits,
  so the name and the measurement have drifted apart.

## Desired Outcome

The calibration metric represents what it measures, and it does not train
autonomy to avoid healthy iterative refactors.

- Either rename / reshape the metric so its label matches "later run touched
  the same file", or require stronger evidence for contradiction (failed
  later run, explicit repair task, critic or regression artifact that names
  the prior work).
- The live monitor still catches real evaluator drift and still feeds the
  existing notify split.

## Constraints

- Keep the monitor + notify split and the import direction
  (`eval-harness` → `autonomy`) intact.
- Do not drop fixture `pass^k` coverage; this signal is about evaluator drift,
  not generator drift.
- No dual paths: pick one contradiction definition and delete the other.

## Done When

- `aggregateCalibration()` and its output field names describe the same
  thing, and either stronger contradiction evidence is required or the name
  reflects "overlapping later edit".
- A focused test covers the chosen definition on realistic core-shrink run
  sequences.
- `src/modules/autonomy/AGENTS.md` "Live-Run Evaluator Calibration" note
  stays accurate, without restating implementation details.

