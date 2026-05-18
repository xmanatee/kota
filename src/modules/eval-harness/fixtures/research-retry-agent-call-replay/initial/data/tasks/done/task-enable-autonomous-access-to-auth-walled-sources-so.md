---
id: task-enable-autonomous-access-to-auth-walled-sources-so
title: Fixture dependency for auth-walled source access
status: done
priority: p3
area: research
summary: Fixture-local predecessor required by the recorded research retry task dependency.
created_at: 2026-04-23T00:00:00.000Z
updated_at: 2026-04-23T00:00:00.000Z
---

## Problem

The research-retry replay writes a blocked task whose `task-done` precondition
depends on this task id.

## Desired Outcome

The fixture working tree contains the dependency target so task validation can
check the explicit edge.

## Constraints

- Keep this task fixture-local; it only exists to satisfy dependency validation
  for the recorded blocked task.

## Done When

- The replay fixture can validate task dependencies without a missing-target
  error.

## Source / Intent

Fixture support record for `research-retry-agent-call-replay`.

## Acceptance Evidence

- `pnpm vitest run src/modules/eval-harness/replay-smoke.test.ts -t 'research-retry-agent-call-replay'`
  passes.
