---
id: task-close-workflow-commit-writescope-gap-for-untracked
title: Close workflow commit writeScope gap for untracked files
status: done
priority: p2
area: core
summary: Make workflow writeScope enforcement and the commit staging step share one path set so untracked files are either ownership-gated or excluded from workflow commits
created_at: 2026-04-21T15:51:32.115Z
updated_at: 2026-04-22T03:30:10.076Z
---

## Problem

Workflow write-ownership enforcement and the final commit step operate on
different file sets, so a workflow's commit can include files the ownership
gate never saw.

- `listMutatedTrackedFiles()` inspects `git diff --name-only HEAD`, so
  untracked files are invisible unless already staged.
- `commitWorkflowChanges()` then runs `git add -A`, sweeping any stray
  untracked file into the workflow commit.
- The current test suite pins this behavior by explicitly expecting untracked
  files to bypass writeScope enforcement, so the gap is codified, not
  accidental.

## Desired Outcome

The ownership gate and the staging command agree on which paths belong to a
workflow run, so commits cannot contain untracked paths that no gate
inspected.

- Untracked repo files appear as workflow-owned mutations during enforcement,
  or the commit step stages only files that already passed the ownership
  gate.
- Scratch-artifact handling stays a separate concern; it does not substitute
  for ownership.

## Constraints

- Do not weaken writeScope for tracked files.
- Do not introduce a second "which files count" mechanism; collapse the two
  call sites onto one path set.
- Keep direct-commit prevention at the `canUseTool` boundary untouched; this
  task is about staging, not about who runs `git commit`.
- Update the pinned test to reflect the new behavior rather than working
  around it.

## Done When

- `listMutatedTrackedFiles()` and `commitWorkflowChanges()` derive their
  target path set from a single source, covering tracked and untracked files
  consistently.
- A workflow that writes an untracked file outside its writeScope fails the
  ownership gate instead of succeeding and sneaking the file into the
  commit.
- The existing "untracked files ignored by writeScope" test is rewritten to
  enforce the new contract.

