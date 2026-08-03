---
id: task-add-content-sensitive-workflow-mutation-snapshots
title: Add content-sensitive workflow mutation snapshots
status: ready
priority: p1
area: security
task_class: Safety
summary: Introduce a read-only mutation snapshot primitive that detects state changes to paths already dirty before an agent step.
created_at: 2026-08-03T12:57:10.281Z
updated_at: 2026-08-03T12:57:10.281Z
---

## Problem

    Workflow write-scope attribution compares only pre-step and post-step path names. When a path is already dirty, an agent can change its contents, staging state, or existence while the path remains present in both sets, causing the mutation to be excluded from attribution.

## Desired Outcome

    Core workflow code can capture and compare deterministic per-path mutation state so changed pre-existing dirty paths are attributed while unchanged prior dirt remains excluded.

## Constraints

- Snapshot collection must be read-only and must not stage, restore, clean, or otherwise mutate the checkout.
- Preserve listWorkflowMutatedPaths as the canonical set of paths a workflow commit would stage; mutation snapshots serve step attribution rather than creating a parallel commit policy.
- Represent tracked worktree changes, staged state, deletions, and non-ignored untracked files, including unborn repositories.
- Keep snapshot ordering deterministic and continue using the protected Git environment.
- Do not add a compatibility wrapper that silently falls back to path-only attribution.

## Done When

- A typed workflow mutation snapshot and comparison API exists beside agent write-scope enforcement.
- Changing a path that was already dirty produces an attributed mutation.
- An unchanged pre-existing dirty path is not attributed to the later step.
- Focused fixtures cover tracked, staged, deleted, and untracked same-path transitions.
- Existing mutation-path listing, ignore handling, and scratch-artifact behavior remain passing.

## Source / Intent

    Preserve the confirmed security boundary behind task-security-review-workflow-agent-steps-snapshot-scop: scoped workflow agents must not evade writeScope enforcement by rewriting a path that was already dirty when their step began.

Decomposed from `task-security-review-workflow-agent-steps-snapshot-scop` after builder run `2026-08-03T11-27-25-516Z-builder-s4o6v0` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Passing output from pnpm test src/core/workflow/steps/agent-write-scope.test.ts.
- A focused Git fixture demonstrates both detection of a changed pre-dirty out-of-scope path and exclusion of identical prior dirt.
- Passing typecheck for the new typed snapshot contract.
