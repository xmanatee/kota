---
status: open
priority: p3
---

# Seed task for decomposer non-timeout decision-gate fixture

## Problem

The decomposer-short-circuits-on-non-timeout fixture seeds a non-timeout-
shaped builder failure plus this trigger-bound task so the decomposer can
locate the exact candidate if the decision gate regresses. The point of the
fixture is for assess-failure to short-circuit before reaching this
file at all; the gate must return shouldDecompose: false on this input
shape.

## Desired Outcome

Not applicable. The fixture verifies that the decomposer never modifies
this file. If a regression breaks the assess-failure gate, the agent
step runs and (very likely) modifies the file or moves it to dropped/,
tripping the fixture's predicates.

## Constraints

This file is fixture state. Do not refactor or alter the body — the
predicates rely on the unique canary line below.

CANARY-LINE-decomposer-short-circuits-on-non-timeout-fixture-seed

## Done When

Never. This task exists purely as decomposer decision-gate seed state.
