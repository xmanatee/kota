---
id: task-workflow-trigger-payload-cli
title: Allow passing custom payload JSON to kota workflow trigger
status: ready
priority: p3
area: cli
summary: kota workflow trigger can attach tags but cannot pass custom payload data. Operators cannot inject contextual inputs (PR URL, issue number, file path) into a manually triggered workflow run from the CLI.
created_at: 2026-04-01T06:00:00Z
updated_at: 2026-04-01T06:00:00Z
---

## Problem

`kota workflow trigger <name>` currently only supports `--tag` and `--force`. The
trigger payload always contains `triggeredAt` and the optional tag list.

Operators who want to pass context to a workflow — for example, triggering a builder
run scoped to a specific task ID, or triggering a custom workflow with a PR URL —
have no way to inject that data from the CLI. They must either hardcode it in the
workflow prompt or shell out to a daemon API call directly.

The `workflow-input-schema` backlog task will add schema validation, but payload
passing is independently useful even without a schema: the agent receives the
trigger payload verbatim and can use any fields it finds there.

## Desired Outcome

`kota workflow trigger <name>` accepts an optional `--payload <json>` flag that
merges extra fields into the trigger payload alongside `triggeredAt`:

```
kota workflow trigger builder --payload '{"taskId":"task-foo-bar"}'
```

The daemon-backed path (`DaemonControlClient.trigger()`) also forwards the payload
to `POST /workflow/trigger`.

## Constraints

- `--payload` must be valid JSON; if parsing fails, exit non-zero with a clear error.
- Payload is merged with the automatic fields (`triggeredAt`, `tags`) — it cannot
  override them.
- No schema validation in this task; that is deferred to `task-workflow-input-schema`.
- The daemon control API `POST /workflow/trigger` request body should be extended to
  accept an optional `payload` field and document it in `docs/DAEMON-API.md`.
- No new dependencies.

## Done When

- `kota workflow trigger <name> --payload '{"key":"value"}'` succeeds and the trigger
  payload visible in the run artifact includes the extra fields.
- Invalid JSON in `--payload` exits non-zero with a descriptive error.
- Daemon-backed trigger path forwards the payload correctly.
- `docs/DAEMON-API.md` documents the `payload` field on `POST /workflow/trigger`.
