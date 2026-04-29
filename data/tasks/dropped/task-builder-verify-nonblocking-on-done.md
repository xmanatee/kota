---
id: task-builder-verify-nonblocking-on-done
title: Treat verify failures as warnings when builder task is already done
status: dropped
priority: p2
area: workflow
summary: When the builder completes a task (task moves to done/) but a post-build verify step fails due to a flaky or unrelated test, the run is marked failed even though the work was delivered. The check-task-outcome result should be used to make verify failures non-blocking when the task is already resolved.
created_at: 2026-03-25
updated_at: 2026-03-25
---

## Why Dropped

Dropped in `60876a66` after the symptom was covered by a broader verify-test
workaround and a separate flaky-suite repair task. This task should stay
dropped: making post-builder verification failures nonblocking after a task is
moved to `done/` would hide real regressions. The better direction is the
current one: keep verification evidence strict and fix unrelated or flaky
failures as their own queue items.

## Problem

The builder's verify steps (verify-typecheck, verify-lint, verify-test) run after the build agent step. If any verify step fails, the run is marked failed and `request-restart` is skipped.

This is misleading when:
1. The builder successfully completed the task (task is now in `done/`).
2. A verify step fails due to a flaky or slow test unrelated to the change.

In this scenario the run appears as a failure even though the delivered work is correct. The improver then spends time investigating a "failure" that isn't a real problem. This pattern has occurred in multiple recent builder runs.

The `check-task-outcome` step was added to detect task completion, but its result is not used to gate or soften the verify steps.

## Desired Outcome

- If `check-task-outcome` shows `resolved: true` (task moved to `done/`), verify step failures use `continueOnFailure: true` so the run completes as success rather than failed.
- If `check-task-outcome` shows `resolved: false`, verify failures continue to block the run (same as today) since the task wasn't completed and a real issue may exist.
- `request-restart` still requires all verify steps (whether they passed or continued-on-failure).

## Constraints

- The `when` condition for verify steps must remain: they only run when the build step succeeded.
- The existing `createVerificationAndRestartSteps` helper may need to accept a `taskOutcomeStepId` parameter so it can conditionally set `continueOnFailure`.
- Do not change verify step behavior for the improver workflow (which does not use `check-task-outcome`).

## Done When

- Builder verify steps set `continueOnFailure: true` dynamically when `check-task-outcome.resolved === true`.
- A builder run where the task is done but a verify step fails is recorded as success, not failed.
- Tests cover both resolved and unresolved paths.
