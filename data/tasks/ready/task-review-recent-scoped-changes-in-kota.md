---
id: task-review-recent-scoped-changes-in-kota
title: Make scope-improver recommendations specific enough to execute
status: ready
priority: p2
area: autonomy
summary: Tighten scope-improver candidate generation so it does not create vague self-referential review tasks from ordinary task-file changes.
created_at: 2026-06-04T13:02:47.903Z
updated_at: 2026-06-04T13:07:31.000Z
---

## Problem

The new `scope-improver` workflow created this ready task with the generic title
"Review recent scoped changes in kota" after a security-review task file was
created. That proves the workflow can react and write normalized tasks, but it
also shows a quality gap: a builder cannot tell what concrete improvement is
expected without reinterpreting the scope-improvement artifact and the triggering
task file.

This is the kind of low-signal task churn the owner explicitly wants KOTA to
avoid. Scope improvement should produce evidence-backed work, not meta-review
placeholders that recursively ask another agent to figure out the work.

## Desired Outcome

Tighten scope-improver discovery and recommendation so generated tasks are
specific enough to execute directly. When evidence only says "a task file
changed" or "recent scoped files changed", the workflow should either suppress
task creation, create an owner question, or create a concrete task whose title,
problem, and Done When name the actual improvement.

The workflow should preserve the cited evidence ids, but the task itself must
name the actionable gap without requiring the builder to inspect unrelated run
metadata first.

## Constraints

- Preserve the cited evidence ids until this task is resolved.
- Keep the work scoped to the directory that produced the finding.
- Do not add prompt-only admonitions. Enforce the quality bar through candidate
  schema, deterministic filters, title/body validation, or tests.
- Do not suppress genuinely useful scope-improvement tasks just because their
  evidence includes task files; suppress only vague or self-referential output.

## Done When

- Scope-improver task recommendations must include a concrete problem statement,
  desired outcome, and Done When derived from evidence rather than a generic
  "review recent changes" placeholder.
- A regression test covers the current failure mode: a changed task file alone
  must not create a vague self-referential ready task.
- Existing tests for task creation, owner-question creation, safe edits,
  multi-scope isolation, and dedupe still pass.
- The scope-improvement artifact remains enough to audit why a candidate was
  skipped, converted to an owner question, or turned into a concrete task.

## Source / Intent

Created by scope-improver workflow run 2026-06-04T13-02-46-915Z-scope-improver-bcjraz.

Evidence ids:

- file:0:data/tasks/ready/task-security-review-the-progress-review-evidence-colle.md

## Initiative

Scope-aware continuous improvement.

## Acceptance Evidence

- Focused scope-improver workflow test output covering vague task suppression.
- Scope-improvement artifact showing the same evidence now yields a concrete
  task, owner question, or skipped recommendation with an explicit reason.
