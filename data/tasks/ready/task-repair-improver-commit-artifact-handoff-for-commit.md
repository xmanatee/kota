---
id: task-repair-improver-commit-artifact-handoff-for-commit
title: Repair improver commit-artifact handoff for committing outcomes
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Trace the three cited runs and repair the owning lifecycle boundary so every improver outcome with stageable changes preserves a valid run-directory commit message before commit-required repair checks execute.
created_at: 2026-08-03T17:10:23.306Z
updated_at: 2026-08-03T17:10:23.306Z
---

## Problem

    Three improver runs reached commit-message-exists without the required artifact. The committing path currently lacks a proven contract connecting agent completion, staged changes, run-directory artifact resolution, and repair-check ordering.

## Desired Outcome

    Improver has one deterministic committing path that resolves the canonical run directory, retains a non-empty commit-message.txt, and executes commit-message and stageability checks only after the artifact is available.

## Constraints

- Use runs 2026-08-03T05-14-19-008Z-improver-cp9dla, 2026-08-03T06-07-24-003Z-improver-uewwcq, and 2026-08-03T07-12-05-870Z-improver-8govyg as primary root-cause evidence.
- Classify each cited run from its step results, repair artifacts, staged state, and workflow definition before changing code; do not assume every run was commit-eligible.
- Repair the defect at the owning workflow or runtime boundary without generating placeholder commit messages or automatically satisfying commit-message-exists.
- Preserve direct-commit prevention, checkCommitStageable, and the requirement for a meaningful commit message whenever changes will be committed.
- Keep cost and throughput information out of prompts, repair feedback, and run-derived autonomy context.

## Done When

- The precise transition, ordering, or path-resolution defect affecting each cited commit-eligible run is identified from durable evidence and fixed at its owner.
- A successful staged-change path produces and resolves a non-empty commit-message.txt under the exact active run directory before commit-message-exists and checkCommitStageable execute.
- Focused tests cover repair-check ordering and both relative and absolute run-directory resolution used by the workflow.
- Existing direct-commit guard and commit-stageability tests continue to pass.
- Commit-ineligible evidence discovered in the cited runs is represented explicitly for the dependent non-committing-outcomes task rather than forced through the committing path.

## Source / Intent

    Restore reliable monitored autonomy execution by repairing the local improver lifecycle defect without hiding the commit-artifact signal, preserving the Product or Safety intent unblocked by the original recovery task.

Decomposed from `task-repair-improver-commit-message-artifact-lifecycle` after builder run `2026-08-03T14-59-50-722Z-builder-xmr4em` exhausted repair.

## Product / Safety Link

This recovery task unblocks the Product or Safety intent preserved by `task-repair-improver-commit-message-artifact-lifecycle`.

## Initiative

    Autonomy fleet health: recurring local workflow failures should graduate into deterministic, reviewable repair work.

## Acceptance Evidence

- Relevant step-result and repair-loop excerpts from all three cited improver run directories showing the classification and shared lifecycle defect.
- Focused test output for the staged-change path, repair-check ordering, and run-directory artifact resolution.
- A before-and-after representative fixture demonstrating that the original committing failure reaches commit validation with the expected artifact.
