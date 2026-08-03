---
id: task-model-and-verify-explicit-improver-non-committing
title: Model and verify explicit improver non-committing outcomes
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Represent every supported improver terminal path without committable changes as a typed, validated non-committing result so commit-only repair checks do not misclassify it as a missing artifact.
depends_on: [task-repair-improver-commit-artifact-handoff-for-commit]
created_at: 2026-08-03T17:10:23.306Z
updated_at: 2026-08-03T17:10:23.306Z
---

## Problem

    The repair lifecycle can treat an outcome with no legitimate commit as though commit-message.txt were missing, causing repair exhaustion instead of an explicit supported completion result.

## Desired Outcome

    Every workflow-supported non-committing terminal path is explicit, observable, and safely bypasses only commit-required checks, while dirty or stageable work remains unable to masquerade as a no-op.

## Constraints

- Enumerate supported non-committing paths from the improver workflow and its durable outputs; do not invent a broad generic success escape hatch.
- Do not remove or weaken commit-message-exists or checkCommitStageable for committing outcomes.
- A non-committing result must be rejected when tracked, untracked, or staged changes require handling.
- Do not create empty commits, placeholder artifacts, or infrastructure exclusions to suppress failures.
- Keep the result and repair feedback free of cost and throughput data.

## Done When

- Each supported non-committing terminal path emits a typed result that reaches a successful explicit terminal state without running commit-only repair checks.
- Focused tests cover every enumerated non-committing path and prove that staged or dirty changes cannot select it.
- The staged-change path still requires a valid commit-message artifact and continues through stageability validation.
- Workflow completion artifacts distinguish committed, explicitly non-committing, and failed outcomes without relying on a missing file as an implicit signal.

## Source / Intent

    Prevent legitimate non-committing improver outcomes from exhausting repair while retaining the safeguards needed to restore dependable autonomous work for the original Product or Safety intent.

Decomposed from `task-repair-improver-commit-message-artifact-lifecycle` after builder run `2026-08-03T14-59-50-722Z-builder-xmr4em` exhausted repair.

## Product / Safety Link

This recovery task unblocks the Product or Safety intent preserved by `task-repair-improver-commit-message-artifact-lifecycle`.

## Initiative

    Autonomy fleet health: recurring local workflow failures should graduate into deterministic, reviewable repair work.

## Acceptance Evidence

- A terminal-outcome test matrix covering every supported non-committing path plus dirty and staged negative cases.
- Focused repair-loop output showing commit-message-exists is skipped only for a validated non-committing result.
- Representative completion artifacts showing the explicit non-commit outcome.
