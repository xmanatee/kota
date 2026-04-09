---
id: task-workflow-webhook-trigger
title: Add inbound webhook trigger type for workflows
status: done
priority: p2
area: runtime
summary: Workflows can only start from runtime events, cron, interval, or idle. A webhook trigger lets external systems (CI/CD pipelines, GitHub Actions, monitoring tools) start a workflow via a signed HTTP POST to the daemon.
created_at: 2026-03-30T20:33:00Z
updated_at: 2026-03-30T20:33:00Z
---

## Problem

Workflow triggers are limited to runtime-internal sources: bus events, cron schedules,
intervals, and idle time. There is no way for an external system to kick off a KOTA
workflow in response to a deployment, a test failure, a merge, or any outside event.
Operators who want this must poll, write custom tools, or simulate idle triggers — all
of which are fragile workarounds.

## Desired Outcome

A `webhook` trigger type accepted in workflow definitions. When the daemon receives a
`POST /webhooks/:workflowName` request with a valid `X-Kota-Webhook-Secret` header, it
starts the workflow and returns `{ runId }`. The request body is available in workflow
steps via `stepOutputs.trigger.body`.

Example workflow trigger:
```ts
trigger: { webhook: true }
```
Secret configured in daemon config (not committed with the workflow definition):
```json
{ "webhooks": { "my-workflow": { "secret": "..." } } }
```

## Constraints

- Implement as a new trigger type alongside `event`, `cron`, `interval`, and `idle`;
  no changes to existing trigger handling.
- Daemon validates `X-Kota-Webhook-Secret` against config; returns 401 if missing or wrong.
- Returns 409 if the workflow is already running and does not allow concurrent runs.
- Trigger payload `{ body, headers, timestamp }` is injected as `stepOutputs.trigger`.
- Secret lives in daemon config only — not in the workflow definition — to avoid
  committing secrets to the repo.
- Document the new route and secret config in `docs/DAEMON-API.md`.

## Done When

- `trigger: { webhook: true }` accepted in workflow definition with secret in daemon config.
- `POST /webhooks/:name` with correct secret starts a run and returns `{ runId }`.
- Invalid or missing secret returns 401; workflow-not-found returns 404.
- Trigger payload available as `stepOutputs.trigger` in subsequent steps.
- Unit and integration tests cover the success path and auth-failure path.
- `docs/DAEMON-API.md` documents the webhook endpoint and secret config format.
