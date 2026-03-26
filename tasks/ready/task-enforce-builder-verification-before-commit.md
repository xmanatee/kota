---
id: task-enforce-builder-verification-before-commit
title: Enforce builder verification before commit
status: ready
priority: p2
area: workflow
summary: Builder currently relies on prompt guidance to run checks before committing. Verification failures can surface after a commit lands. Make "verified before commit" structural so this cannot be bypassed accidentally.
created_at: 2026-03-25
updated_at: 2026-03-26
---

## Problem

The builder workflow depends on prompt guidance to run full checks before committing. In practice, task moves and code changes can land in a commit before the workflow-level verification pipeline catches failures. This leads to repeated failed builder runs that have to be recovered and requeued.

Recent history shows multiple failed builder runs caused by committing before verification was solid — e.g., flaky tests, pre-existing failures — that required improver cycles to recover.

## Desired Outcome

- The workflow structure (not just prompt guidance) prevents a commit from landing unless verification has passed in the same step.
- Normal successful runs remain clean and fast — the change should not create overhead on happy paths.
- The mechanism is visible and easy to reason about.

## Constraints

- Do not add test-only flags or production overrides to support the check.
- Keep the solution narrow to the builder workflow and its step ordering.
- Preserve the existing commit-then-move semantics where verification is already passing.

## Done When

- It is structurally impossible for the builder to commit without passing verification in the same session.
- The mechanism is reflected in the workflow definition or step contract, not only in prompt text.
- Tests confirm the verification gate cannot be bypassed.
