---
id: task-invalidate-active-native-and-opaque-harness-runs-o
title: Invalidate active native and opaque harness runs on restrictive policy revisions
status: done
priority: p1
area: security
task_class: Safety
summary: Cancel or quarantine harness execution that cannot reauthorize native tool calls when its starting authority revision becomes stale through restriction.
depends_on: [task-add-revisioned-observable-scope-policy-authority]
created_at: 2026-08-03T13:16:46.780Z
updated_at: 2026-08-03T22:51:58.759Z
---

## Problem

    Native or opaque harnesses may perform tool calls outside KOTA's hosted authorization callback. Resolving policy at hosted boundaries cannot revoke those capabilities during an already-running harness session.

## Desired Outcome

    Track each active harness run against its authority revision and, when a restrictive mutation lands, refresh only through a capability-safe harness contract or otherwise cancel and quarantine the stale execution before accepting further calls or outputs.

## Constraints

- Depend on the canonical revisioned authority source and do not create harness-specific policy state.
- Default to cancellation and quarantine when a harness cannot prove that it refreshed authority before another native action.
- Do not accept completion output, success state, or mutations from an execution invalidated by a restrictive revision.
- Clean up authority subscriptions and cancellation resources on success, failure, timeout, and abort.
- Do not cancel solely for equal or purely permissive policy updates unless required by an existing safety invariant.

## Done When

- Active native or opaque harness runs retain their starting authority revision and observe restrictive revision changes.
- A restrictive change causes supported live refresh or aborts the run and quarantines late callbacks and terminal output.
- A regression starts an opaque harness under allowed policy, applies a restrictive mutation, and proves no later native action or stale successful completion is accepted.
- Tests cover cancellation races and listener cleanup across terminal paths.
- The final focused verification command and passing result are recorded in the task.

## Source / Intent

    Complete the non-interceptable portion of confirmed finding active-workflow-scope-policy-snapshot by ensuring policy-only authority mutations affect active native and opaque harness execution.

Decomposed from `task-security-review-workflow-agent-steps-snapshot-scop` after builder run `2026-08-03T11-27-25-516Z-builder-s4o6v0` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- A fake-harness regression demonstrating restrictive revision invalidation during an active run.
- Assertions that late native actions and stale completion output are rejected or quarantined.
- A recorded passing focused test command covering cancellation races and cleanup.

## Verification

`NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true --reporter=dot src/core/agent-harness/runner.test.ts src/core/agent-harness/runner-session-environment.test.ts src/abort-cross-harness.integration.test.ts src/core/workflow/steps/workflow-agent-harness-runner.test.ts src/core/workflow/run-executor-scope-policy.test.ts src/modules/codex-agent-harness/adapter.test.ts src/modules/gemini-cli-agent-harness/adapter.test.ts src/modules/antigravity-cli-agent-harness/adapter.test.ts src/strict-types-policy.integration.test.ts src/core/agent-harness/no-sdk-shaped-neutral-fields.test.ts`

Passed on 2026-08-04: 10 test files and 68 tests passed, including a real descendant-process mutation regression. `node_modules/.bin/tsc --noEmit` and the focused Biome check also passed.
