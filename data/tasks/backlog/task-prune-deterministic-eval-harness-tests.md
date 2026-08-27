---
id: task-prune-deterministic-eval-harness-tests
title: Prune deterministic eval harness duplication
status: backlog
priority: p1
area: eval-harness
summary: Keep eval fixtures only for agent capability, realistic multi-step behavior, and historical failures that deterministic owners cannot represent.
task_class: Meta
depends_on: [task-align-verification-ownership-and-cadences, task-simplify-workflow-and-autonomy-tests]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

The eval harness increasingly duplicates deterministic product validation, workflow lifecycle, fixture repository construction, scorer mechanics, and ordinary integration behavior. Copied repositories and replay fixtures can make a second executable specification whose maintenance is counted separately but whose failure value is unclear.

## Desired Outcome

Every retained eval states the model-dependent capability or realistic trajectory it measures and why deterministic proof is insufficient. Deterministic application and protocol behavior moves to its owning mechanism; obsolete fixtures, copied repos, scorers, and compatibility replay formats are deleted.

## Constraints

- Preserve high-value regressions for past agent failures, weak-model behavior, research, planning, tool use, and multi-step coding outcomes.
- Do not relabel deterministic tests as evals or move support into fixture data to satisfy LOC accounting.
- Keep scorer contracts small, outcome-oriented, and independent of hidden reasoning or exact implementation paths.
- Align eval cadence and cost with the verification standard rather than the default owner suite.

## How We Will Know

- Each fixture has a named model-dependent failure and a decision it informs.
- Deterministic product, protocol, and runtime behaviors have one owner outside the eval harness.
- Obsolete replay formats, duplicated fixture repositories, and scorer-only scaffolding are removed rather than archived indefinitely.
- Eval test and authored fixture/support LOC falls within the non-additive 12k-14k opportunity band while meaningful capability coverage remains.
