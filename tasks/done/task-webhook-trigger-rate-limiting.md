---
id: task-webhook-trigger-rate-limiting
title: Add per-workflow rate limiting for inbound webhook triggers
status: done
priority: p3
area: runtime
summary: Webhook triggers have no built-in rate limit. A misconfigured upstream or a replay attack can flood the queue with hundreds of runs per minute. A configurable per-workflow rate limit would cap inbound webhook throughput without requiring an external proxy.
created_at: 2026-04-02T00:34:41Z
updated_at: 2026-04-02T03:00:00Z
---

## Problem

`POST /webhooks/:workflowName` triggers a workflow run for every valid inbound request.
`cooldownMs` exists on event triggers, but webhook triggers do not respect it — each HTTP
request creates an independent run immediately.

A noisy upstream (CI pipeline with many concurrent jobs, a misconfigured GitHub webhook,
or a replay attack) can enqueue dozens of runs per minute for the same workflow. The queue
grows unboundedly, agent concurrency slots are starved, and the daily budget ceiling may
be hit before legitimate work can run.

## Desired Outcome

`WorkflowDefinition` gains an optional `webhookRateLimit` config block:

```json
{
  "webhookRateLimit": {
    "maxPerMinute": 10
  }
}
```

When set, the daemon control webhook handler (`daemon-control-webhook.ts`) tracks the
last-triggered timestamps for the workflow and rejects requests that exceed the cap with
`429 Too Many Requests` and a `Retry-After` header. The counter resets on a sliding
60-second window. Requests rejected by the rate limiter do not enqueue a run.

Default behavior (no `webhookRateLimit`) is unchanged — no cap applied.

## Constraints

- In-process only; no Redis or external counter needed. State lives in daemon memory (lost on restart, which is acceptable).
- `maxPerMinute` is the only required field; future fields (burst, per-IP) are out of scope.
- The `429` response must include a `Retry-After` header (seconds until next available slot).
- The rate limiter state is per workflow name, not global.
- Existing webhook HMAC validation runs before the rate limiter check.
- Document the config field in `docs/WORKFLOWS.md` or a webhook section.

## Done When

- `WorkflowDefinition` and workflow validation accept an optional `webhookRateLimit.maxPerMinute` field.
- The webhook handler enforces the cap and returns `429` with `Retry-After` when exceeded.
- Requests within the limit enqueue normally.
- Unit test covers the rate-limiting path (requests at/above/below limit).
- Config field is documented.
