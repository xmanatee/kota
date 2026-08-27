---
status: done
---

# Build reusable AGY model evaluation suite in eval-harness

## Problem

    Model-family labels and literal preset assertions cannot verify that AGY models plan carefully, follow repository guidelines, limit file edits, and complete long-horizon repair loops.

## Desired Outcome

    Build a repeatable evaluation suite in src/modules/eval-harness/ that runs candidate models through isolated KOTA workload scenarios via the antigravity-cli harness and records trace, changed-path scope, instruction adherence, and rubric verdicts.

## Constraints

- Evaluate candidates at maximum AGY-supported effort setting.
- Do not use live canonical queue tasks as benchmark inputs; use isolated test fixtures.
- Treat guideline violations and unrelated file edits as first-class rubric failures.
- Fail visibly if a requested candidate model or effort is unavailable.

## Done When

- Scenario runner in eval-harness executes planning, scoped coding, and repair scenarios via antigravity-cli.
- Each scenario run logs per-candidate traces, modified path scope, rubric scores, and pass/fail verdicts.
- Unit and integration tests in eval-harness pass for evaluation runner and metric collection.

## Source / Intent

    Owner direction on 2026-08-07: make AGY model selection evidence-driven against real KOTA workloads, evaluating instruction adherence and scope control.

Decomposed from `task-validate-agy-model-routing-against-long-horizon-co` after builder run `2026-08-07T01-57-52-891Z-builder-epufuo` exhausted repair.

## Initiative

    Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- Executable eval-harness scenario runner script and module in src/modules/eval-harness/.
- Passing test suite for scenario execution and metric collection logic.
