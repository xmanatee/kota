---
id: task-repair-improver-commit-message-artifact-lifecycle
title: Repair improver commit-message artifact lifecycle
status: dropped
priority: p1
area: autonomy
task_class: Meta
summary: Find and fix why improver repeatedly reaches its commit repair gate without producing the required run-directory commit-message artifact.
created_at: 2026-08-03T14:21:53.396Z
updated_at: 2026-08-03T17:10:23.344Z
---

## Problem

    Improver runs 2026-08-03T05-14-19-008Z-improver-cp9dla, 2026-08-03T06-07-24-003Z-improver-uewwcq, and 2026-08-03T07-12-05-870Z-improver-8govyg all exhausted repair at step improve because commit-message-exists remained unsatisfied. The repeated identical local failure indicates a broken contract among improver terminal paths, run-directory handoff, finish instructions, and repair-check ordering rather than isolated agent variance.

## Desired Outcome

    Every improver terminal path either leaves stageable changes with a valid run-directory commit-message artifact before commit-required repair checks execute, or reaches an explicitly supported non-committing outcome without being misclassified as a missing-artifact repair failure.

## Constraints

- Use the three cited improver run directories, step results, repair-loop artifacts, and workflow definition as the primary root-cause evidence.
- Preserve direct-commit prevention, checkCommitStageable, and the requirement for a commit message whenever the workflow will commit changes.
- Do not remove, weaken, or automatically satisfy commit-message-exists merely to suppress the failure signal.
- Keep cost and throughput data out of agent prompts, repair feedback, and run-derived autonomy context.
- If the repair materially changes workflow, prompt, harness, reviewer, or repair-loop behavior, include the required autonomy-change-decision.json with baseline, candidate, evidence, rollout, and verdict.

## Done When

- The exact lifecycle defect causing all three cited runs to omit or lose commit-message.txt is identified and repaired at its owning workflow or runtime boundary.
- Focused tests cover a successful staged-change path and every supported non-committing terminal path, including repair-check ordering and run-directory artifact resolution.
- A fresh improver runtime probe or representative integration fixture terminates without repair exhaustion on commit-message-exists and records the expected commit artifact or explicit supported non-commit result.
- Existing commit guard and stageability tests continue to pass.

## Source / Intent

    Restore reliable monitored autonomy execution by repairing the local improver failure instead of broadening infrastructure exclusions or hiding the commit-artifact signal.

Decomposed from `task-repair-workflow-failure-pattern-d4f42f3e7dbc` after builder run `2026-08-03T13-20-05-894Z-builder-ceqy9p` exhausted repair.

## Product / Safety Link

This recovery task unblocks the Product or Safety intent preserved by `task-repair-workflow-failure-pattern-d4f42f3e7dbc`.

## Initiative

    Autonomy fleet health: recurring local workflow failures should graduate into deterministic, reviewable repair work.

## Acceptance Evidence

- Focused improver and repair-loop test output covering changed and non-committing outcomes.
- Before-and-after run artifacts showing the cited failure mode and a fresh successful terminal path.
- The autonomy change decision artifact when required by the final implementation scope.

## Decomposed

- task-repair-improver-commit-artifact-handoff-for-commit
- task-model-and-verify-explicit-improver-non-committing
- task-prove-the-repaired-improver-lifecycle-in-a-runtime
