---
id: task-workflow-step-retry
title: Add retry-with-backoff to failing workflow steps
status: backlog
priority: p2
area: workflow
summary: Agent steps have no retry logic. A transient network error, API rate limit, or brief outage fails the entire workflow run. Adding optional per-step retry with exponential backoff would make the autonomous loop more resilient without changing behavior for non-transient failures.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`WorkflowAgentStep` runs once. Any transient failure (rate limit, network timeout, SDK error) immediately marks the step as failed and propagates failure to the whole workflow run. The daemon then fires the Telegram alert and waits for the next trigger cycle. For an autonomous system that runs unattended, even occasional transient errors break runs that would have succeeded if retried.

## Desired Outcome

- `WorkflowAgentStep` (and optionally `WorkflowToolStep`) accepts an optional `retry` config: `{ maxAttempts: number, initialDelayMs: number, backoffFactor: number }`.
- On step failure, the executor retries up to `maxAttempts` times with exponential backoff before marking the step as permanently failed.
- Retry attempts are logged with attempt number and delay.
- No behavior change when `retry` is not specified.
- Tests cover retry logic: exhausted retries fail the step; a step that succeeds on the second attempt passes.

## Constraints

- Retry config is opt-in per step; default is no retry (preserves existing behavior).
- The wall-clock timeout (`timeoutMs`) applies across all attempts combined, not per attempt.
- Do not retry `code` steps — they are synchronous and deterministic; failures there indicate a logic error, not a transient condition.

## Done When

- `retry` field is defined in `WorkflowAgentStep` type.
- `step-executor.ts` implements retry logic respecting `maxAttempts`, `initialDelayMs`, and `backoffFactor`.
- Explorer and builder workflows opt in to retry where appropriate.
- Unit tests cover retry scenarios.
