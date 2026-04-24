---
id: task-fixture-decomposer-decision-seed
title: Seed task for decomposer non-timeout decision-gate fixture
status: doing
priority: p3
area: eval-harness
summary: Seeded by the decomposer-short-circuits-on-non-timeout fixture so a builder-claimed task exists in doing/ if the decomposer ever progresses past the assess-failure gate. Predicates verify this file is unchanged after the run.
created_at: 2026-04-24T00:00:00.000Z
updated_at: 2026-04-24T00:00:00.000Z
---

## Problem

The decomposer-short-circuits-on-non-timeout fixture seeds a non-timeout-
shaped builder failure plus this "claimed" task so the decomposer can
locate a candidate if the decision gate regresses. The point of the
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
