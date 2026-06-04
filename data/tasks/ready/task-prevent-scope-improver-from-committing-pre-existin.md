---
id: task-prevent-scope-improver-from-committing-pre-existin
title: Prevent scope improver from committing pre-existing untracked files
status: ready
priority: p1
area: autonomy
summary: Make scope-improver commit only workflow-owned mutations and block pre-existing untracked or dirty files before applying recommendations.
created_at: 2026-06-04T13:07:22.333Z
updated_at: 2026-06-04T13:07:22.333Z
---

## Problem

The new `scope-improver` workflow checks only `trackedDirty` before applying
recommendations:

- `src/modules/autonomy/workflows/scope-improver/workflow.ts:45-47`

The shared workflow commit path later stages `listWorkflowMutatedPaths`, which
includes non-ignored untracked files:

- `src/core/workflow/steps/agent-write-scope.ts:44-72`
- `src/modules/autonomy/commit.ts:141-161`

That means a pre-existing untracked owner file can be invisible to
`scope-improver`'s cleanliness gate but still be included in the workflow
commit after the workflow writes its own task or safe edit.

## Desired Outcome

Make `scope-improver` commit only workflow-owned mutations. The workflow should
either block on any pre-existing dirty state, including untracked files, or
capture a pre-run baseline and commit only paths introduced by its own
recommendation step.

The chosen contract must be explicit and testable: pre-existing user/daemon
files are never silently staged or committed by scope-improver.

## Constraints

- Do not stash, delete, reset, or rewrite pre-existing user files.
- Do not weaken the generic workflow write-scope and commit guards.
- Do not create a second commit mechanism just for this workflow if the shared
  autonomy commit boundary is the right owner.
- Keep run artifacts clear when the workflow skips mutation due to dirty state.

## Done When

- A regression test creates a pre-existing untracked file before a scope-improver
  run and proves the workflow does not stage or commit it.
- A positive test still proves scope-improver can create and commit its own
  normalized task or allowed safe edit in a clean worktree.
- The commit path and cleanliness check share one explicit ownership contract or
  baseline snapshot.
- `pnpm run validate-tasks` and focused scope-improver/autonomy commit tests pass.

## Source / Intent

Architecture review on 2026-06-04 while auditing the unpushed daemon work. The
owner asked for a professional, unbiased check of whether the continuous scope
improvement implementation is safe and correctly structured.

This follows the existing completed write-scope hardening work, but covers a
new workflow-level gap: `scope-improver`'s preflight cleanliness predicate does
not match the path set that the shared commit step stages.

## Initiative

Scope-aware continuous improvement.

## Acceptance Evidence

- Focused test transcript for `src/modules/autonomy/workflows/scope-improver/workflow.test.ts`
  and any shared autonomy commit tests touched by the fix.
- Runtime artifact or test assertion showing pre-existing untracked files remain
  unstaged after a scope-improver run.
