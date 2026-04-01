# Daemon Control API

When the KOTA daemon is running, it exposes a loopback HTTP control API. This
is the canonical live source of truth for daemon status, workflow state,
history, approvals, and task queue.

## Discovery

The daemon writes its control address to `.kota/daemon-control.json`:

```json
{
  "port": 49251,
  "pid": 12345,
  "startedAt": "2026-03-27T12:00:00.000Z",
  "token": "a3f8..."
}
```

Clients discover the address by reading this file. If the file does not exist,
or if the HTTP request fails, the daemon is not running.

Use `DaemonControlClient.fromStateDir()` from `src/server/daemon-client.ts` to
get a ready-to-use client in TypeScript. The client reads the token from the
lock file automatically and sends it with all requests.

## Protocol

All endpoints are HTTP + JSON, served on `127.0.0.1` (loopback only). Requests
must include an `Authorization: Bearer <token>` header matching the token in
`daemon-control.json`. Requests without a valid token receive `401 Unauthorized`.

Routes are tagged with a capability scope:

- **`read`** — observe daemon and workflow state, subscribe to events:
  `GET /status`, `GET /workflow/status`, `GET /workflow/definitions`, `GET /events`,
  `GET /api/events`, `GET /workflow/runs`, `GET /workflow/runs/:id`,
  `GET /history`, `GET /history/:id`, `GET /approvals`, `GET /tasks`,
  `GET /sessions`, `GET /metrics`
- **`control`** — mutate workflow dispatch and data:
  `POST /workflow/pause`, `POST /workflow/resume`, `POST /workflow/abort`,
  `POST /workflow/runs/:id/abort`,
  `POST /workflow/reload`, `POST /workflow/trigger`,
  `DELETE /workflow/runs/:id`,
  `DELETE /history/:id`, `POST /approvals/:id/approve`,
  `POST /approvals/:id/reject`,
  `POST /sessions/register`, `DELETE /sessions/:id`

`GET /health` requires **no authentication** and is intended for liveness/readiness probes.

## Health Endpoint

### GET /health

Returns daemon liveness and component health. No authentication required.

**Response (200 — healthy):**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeMs": 12345,
  "components": {
    "scheduler": "ok",
    "extensions": "ok"
  }
}
```

**Response (503 — degraded):**

```json
{
  "status": "degraded",
  "version": "0.1.0",
  "uptimeMs": 12345,
  "components": {
    "scheduler": "ok",
    "extensions": "error"
  }
}
```

Returns `200` when all components report `"ok"`, `503` when any component reports `"error"`.
`uptimeMs` is the milliseconds elapsed since the daemon started.

## Workflow Endpoints

### GET /status

Returns the full live daemon status including workflow state.

**Response:**

```json
{
  "running": true,
  "pid": 12345,
  "startedAt": "2026-03-27T12:00:00.000Z",
  "completedRuns": 42,
  "lastCompletedWorkflow": "builder",
  "lastCompletedAt": "2026-03-27T11:59:00.000Z",
  "lastCompletedStatus": "success",
  "workflow": {
    "activeRuns": [
      { "runId": "2026-03-27T...", "workflow": "builder", "startedAt": "..." }
    ],
    "queueLength": 0,
    "completedRuns": 42,
    "workflows": {
      "builder": {
        "lastRunId": "...",
        "lastStartedAt": "...",
        "lastCompletedAt": "...",
        "lastStatus": "success"
      }
    },
    "paused": false
  }
}
```

The `workflow.activeRuns` array exposes all currently running workflow agent
sessions. The `sessions` array lists active interactive sessions registered by
`kota serve`.

**Response includes:**

```json
{
  "sessions": [
    { "id": "a1b2c3d4", "createdAt": "2026-03-30T16:00:00.000Z", "lastActive": 1743350400000 }
  ]
}
```

### GET /workflow/status

Returns live workflow runtime state only.

**Response:**

```json
{
  "activeRuns": [],
  "pendingRuns": [],
  "queueLength": 0,
  "completedRuns": 42,
  "totalCostUsd": 0.0012,
  "agentBackoff": null,
  "definitionsLoadedAt": "2026-03-27T12:00:00.000Z",
  "workflows": {},
  "paused": false
}
```

### GET /workflow/definitions

Returns the currently loaded workflow definitions. Use this to show trigger
types, cron schedules, step counts, and enabled state in thin clients without
reading config files directly.

**Response:**

```json
{
  "definitions": [
    {
      "name": "builder",
      "enabled": true,
      "stepCount": 5,
      "triggers": [
        { "type": "event", "event": "workflow.completed" },
        { "type": "cron", "schedule": "0 * * * *" },
        { "type": "interval", "intervalMs": 3600000 },
        { "type": "webhook" }
      ]
    }
  ]
}
```

Each trigger entry has a `type` discriminant:
- `"event"` — event-triggered; `event` is the bus event name
- `"cron"` — cron schedule; `schedule` is a standard 5-field cron expression
- `"interval"` — interval trigger; `intervalMs` is the repeat interval in milliseconds
- `"webhook"` — fires via `POST /webhooks/:name`

**Client method:** `DaemonControlClient.getWorkflowDefinitions()`

### GET /workflow/runs

Returns recent workflow run summaries.

**Query parameters:**
- `workflow` (optional string) — filter by workflow name
- `tag` (optional string) — filter to runs that include this tag
- `limit` (optional integer, default 20, max 200)
- `causedByRunId` (optional string) — return only runs whose `causedBy.runId` matches this value (direct downstream children of the given run)

**Response:**

```json
{
  "runs": [
    {
      "id": "2026-03-30T18-12-57-615Z-builder-tplfx4",
      "workflow": "builder",
      "status": "success",
      "triggerEvent": "workflow.completed",
      "startedAt": "2026-03-30T18:12:57.615Z",
      "durationMs": 304802,
      "totalCostUsd": 0.47,
      "triggeredByRunId": "2026-03-30T18-07-52-809Z-explorer-45lcon",
      "causedBy": { "runId": "2026-03-30T18-07-52-809Z-explorer-45lcon", "workflow": "explorer" },
      "tags": ["ci", "pr-42"]
    }
  ]
}
```

`tags` is optional; omitted when no tags were attached at trigger time.
`causedBy` is present only when the run was triggered by `workflow.completed`; it records the upstream run (`runId`, `workflow`) that emitted the event, enabling operators to trace autonomous trigger chains.

### GET /workflow/runs/:id

Returns full run detail for a specific run: metadata plus per-step status,
duration, error, and cost. Does not return full agent log output.

`triggerPayload` is included when the trigger payload is non-empty (webhook, github-event,
and manual trigger runs). Absent for event-only triggers with no payload fields.

**Response:**

```json
{
  "id": "2026-03-30T18-12-57-615Z-builder-tplfx4",
  "workflow": "builder",
  "status": "success",
  "triggerEvent": "workflow.completed",
  "startedAt": "2026-03-30T18:12:57.615Z",
  "completedAt": "2026-03-30T18:18:00.000Z",
  "durationMs": 304802,
  "totalCostUsd": 0.47,
  "triggerPayload": { "workflow": "explorer", "runId": "2026-03-30T18-07-52-809Z-explorer-45lcon", "status": "success" },
  "causedBy": { "runId": "2026-03-30T18-07-52-809Z-explorer-45lcon", "workflow": "explorer" },
  "tags": ["ci", "pr-42"],
  "steps": [
    {
      "id": "inspect-ready-queue",
      "type": "code",
      "status": "success",
      "durationMs": 120
    },
    {
      "id": "build",
      "type": "agent",
      "status": "success",
      "durationMs": 300000,
      "costUsd": 0.47
    }
  ]
}
```

Returns `404` if the run is not found.

### POST /workflow/trigger

Enqueues a workflow run manually.

**Request body:**

```json
{ "name": "builder", "tags": ["ci", "pr-42"], "payload": { "taskId": "task-foo-bar" } }
```

`name` (required) — workflow name. `tags` (optional) — array of strings attached to the run for filtering and grouping; available on run summaries returned by `GET /workflow/runs`. `payload` (optional) — a JSON object whose fields are merged into the trigger payload. Automatic fields (`triggeredAt`, `_runId`, `tags`) are set after merging and cannot be overridden by `payload`.

**Response (200):**

```json
{ "ok": true, "queued": "builder", "runId": "2026-03-31T17-36-31-565Z-builder-abc123" }
```

`runId` is the stable ID assigned to the queued run. Pass it to `DELETE /workflow/runs/:id` to cancel the run before it starts.

**Error responses:**

| Status | Condition |
|--------|-----------|
| 400 | `name` missing, invalid, or unknown workflow |
| 409 | Workflow is already queued |

### POST /workflow/pause

Pauses workflow dispatch. The daemon stops starting new workflow runs until
resumed.

**Response:**

```json
{ "ok": true, "paused": true }
```

If already paused:

```json
{ "ok": true, "paused": true, "already": true }
```

### POST /workflow/resume

Resumes workflow dispatch.

**Response:**

```json
{ "ok": true, "paused": false }
```

If already running (not paused):

```json
{ "ok": true, "paused": false, "already": true }
```

### POST /workflow/runs/:id/abort

Aborts a single active workflow run by ID, leaving all other active runs
untouched. Fires the run's per-run `AbortController`; the run terminates on
its next step boundary with the same clean-abort semantics as the global abort.

**Path parameter:** `:id` — the run ID of the active run to abort.

**Response:**

```json
{ "ok": true }
```

**Error responses:**

- `404` — no run with that ID is currently active.
- `409` — the run exists but is queued, not active; use `DELETE /workflow/runs/:id` to cancel it.

**Scope:** `control`

---

### DELETE /workflow/runs/:id

Cancels a queued (pending) workflow run before it starts. Has no effect on
active runs; use `POST /workflow/runs/:id/abort` for those.

**Path parameter:** `:id` — the run ID shown in `GET /workflow/status`
`pendingRuns[].runId` and in `kota workflow status`.

**Response:**

```json
{ "ok": true }
```

**Error responses:**

- `404` — no queued run with that ID exists.
- `409` — the run is currently active; use `POST /workflow/runs/:id/abort` to abort it.

**Scope:** `control`

---

### POST /workflow/abort

Aborts all currently active workflow runs by cancelling their abort controllers.

**Response:**

```json
{ "ok": true, "aborted": 1 }
```

`aborted` is the number of runs that were signalled. Zero means no runs were active.

### POST /workflow/reload

Reloads workflow definitions in-process without restarting the daemon. Schedule
triggers are reconciled against the new definitions.

**Response:**

```json
{ "ok": true, "count": 3 }
```

`count` is the number of definitions after reload.

### GET /events

Opens a Server-Sent Events stream. The daemon pushes typed events as they
occur. Clients stay connected and receive events in real time without polling.

**Query parameters:**

| Parameter | Description |
|-----------|-------------|
| `since`   | Optional ISO 8601 timestamp. Buffered events with `timestamp > since` are replayed immediately before live streaming begins. Enables seamless reconnection without missing events. |

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event types:**

| Event type                | When emitted                                          |
|---------------------------|-------------------------------------------------------|
| `workflow.started`        | A workflow run begins                                 |
| `workflow.completed`      | A workflow run finishes (success, failed, etc.)       |
| `workflow.step.completed` | An individual workflow step finishes                  |
| `queue.changed`           | After `workflow.started` or `workflow.completed`      |
| `approval.changed`        | An approval is enqueued, approved, rejected, expired  |
| `task.changed`            | An agent session task is created, updated, or cleared |

**`approval.changed` payload:**

```json
{ "id": "a1b2c3d4", "pendingCount": 2 }
```

`id` is the affected approval id. `pendingCount` is the number of approvals
still in `pending` state after the mutation. Clients can use `pendingCount > 0`
to show a badge without polling `GET /approvals`.

**`task.changed` payload:**

```json
{ "counts": { "pending": 3, "in_progress": 1, "done": 7 } }
```

Counts reflect the agent session task store (TodoWrite tool) state after the
mutation. Clients can react to task queue depth changes without polling.

Each event is formatted as standard SSE:

```
event: workflow.started
data: {"workflow":"builder","runId":"2026-03-28T...","triggerEvent":"runtime.idle",...}

```

`DaemonControlClient.events()` returns an `AsyncGenerator<DaemonSseEvent>` that
subscribes to this endpoint. Web clients can use the proxied
`GET /api/daemon/events` route on the HTTP server instead.

### GET /api/events

Returns buffered events from the in-memory ring buffer as JSON. Useful for
clients that want to catch up on recent events without opening an SSE stream.

**Query parameters:**

| Parameter | Description |
|-----------|-------------|
| `since`   | Optional ISO 8601 timestamp. Only events with `timestamp > since` are returned. |
| `limit`   | Optional integer. Maximum number of events to return (from the newest end). |

**Response:**

```json
{
  "events": [
    {
      "type": "workflow.completed",
      "payload": { "workflow": "builder", "runId": "2026-03-28T...", "status": "success" },
      "timestamp": "2026-03-28T10:05:00.123Z"
    }
  ]
}
```

Events are ordered oldest-first. The buffer retains the last N events in memory
(default 500, configurable via `daemon.eventBufferSize` in `kota.config`).

## History Endpoints

### GET /history

Lists conversation history records.

**Query parameters:** `search` (optional string), `limit` (optional integer, default 20, max 1000)

**Response:**

```json
{
  "conversations": [
    {
      "id": "abc123",
      "title": "My conversation",
      "createdAt": "2026-03-27T12:00:00.000Z",
      "updatedAt": "2026-03-27T12:01:00.000Z",
      "model": "claude-opus-4-6",
      "messageCount": 8,
      "cwd": "/Users/user/project",
      "source": "user"
    }
  ]
}
```

### GET /history/:id

Returns the full conversation data for a given conversation ID.

**Response:** Full `ConversationData` object (record + messages).

Returns `404` if not found.

### DELETE /history/:id

Deletes a conversation by ID.

**Response:** `204 No Content` on success, `404` if not found.

## Approval Endpoints

### GET /approvals

Lists all pending approval requests.

**Response:**

```json
{
  "approvals": [
    {
      "id": "a1b2c3d4",
      "tool": "shell",
      "input": { "command": "rm -rf /tmp/old" },
      "risk": "dangerous",
      "reason": "cleanup script",
      "createdAt": "2026-03-27T12:00:00.000Z",
      "status": "pending",
      "timeoutMs": 3600000
    }
  ]
}
```

`timeoutMs` is optional. When present, the item auto-expires after that many milliseconds from `createdAt`. The daemon sweeps for stale approvals periodically; expired items transition to `status: "expired"` and are removed from the pending list. A global sweep TTL can be configured via `approvalTtlMs` in `.kota/config.json` (applies when no per-item `timeoutMs` is set).

### POST /approvals/:id/approve

Approves a pending approval request.

**Response:** `{ "approval": <PendingApproval> }` with status `approved`.

Returns `404` if not found or not pending.

### POST /approvals/:id/reject

Rejects a pending approval request.

**Request body (optional):** `{ "reason": "optional rejection reason" }`

**Response:** `{ "approval": <PendingApproval> }` with status `rejected`.

Returns `404` if not found or not pending.

## Task Endpoints

### GET /tasks

Returns the current task queue status from the `tasks/` directory.

**Response:**

```json
{
  "counts": {
    "inbox": 0,
    "ready": 3,
    "backlog": 5,
    "doing": 1,
    "blocked": 0
  },
  "tasks": {
    "doing": [
      {
        "id": "task-foo",
        "title": "Implement foo",
        "priority": "p1",
        "area": "runtime",
        "summary": "Short description",
        "body": "Full markdown body..."
      }
    ],
    "ready": [...],
    "backlog": [...],
    "blocked": [...]
  }
}
```

## Server Routes Backed By Daemon API

The KOTA HTTP server (`kota serve`) proxies these routes to the daemon control
API when the daemon is running:

| Server route                        | Daemon endpoint               |
|-------------------------------------|-------------------------------|
| GET /api/daemon/status              | GET /status                   |
| GET /api/daemon/events              | GET /events (SSE proxy)       |
| GET /api/workflow/status            | GET /workflow/status          |
| POST /api/workflow/pause            | POST /workflow/pause          |
| POST /api/workflow/resume           | POST /workflow/resume         |
| POST /api/workflow/abort            | POST /workflow/abort          |
| POST /api/workflow/runs/:id/abort   | POST /workflow/runs/:id/abort |
| POST /api/workflow/reload           | POST /workflow/reload         |
| POST /api/workflow/trigger          | POST /workflow/trigger        |
| GET /api/history                    | GET /history                  |
| GET /api/history/:id                | GET /history/:id              |
| DELETE /api/history/:id             | DELETE /history/:id           |
| GET /api/approvals                  | GET /approvals                |
| POST /api/approvals/:id/approve     | POST /approvals/:id/approve   |
| POST /api/approvals/:id/reject      | POST /approvals/:id/reject    |
| GET /api/tasks                      | GET /tasks                    |

When the daemon is not running:
- `/api/daemon/status` returns `{ daemon: null }`.
- Workflow status routes return empty state. Pause and resume return 503.
- History, approvals, and task routes fall back to reading from the local
  process state (in-process stores and `tasks/` files directly).

Queuing a workflow (`POST /api/workflow/trigger`) proxies to the daemon when
available, or writes directly to `.kota/workflow-state.json` as a fallback.
Run artifacts in `.kota/runs/` are durable evidence and are read directly by
the server for run listing and streaming.

## Webhook Trigger Endpoint

### POST /webhooks/:name

Triggers a workflow run from an external system. This endpoint uses a separate
per-workflow secret and does **not** require the daemon Bearer token.

**Auth:** Requests must be signed with HMAC-SHA256 using the workflow's configured
secret. Send the signature in the `X-Kota-Webhook-Signature` header with the format
`sha256=<hex>`. The secret is configured in `.kota/config.json` under
`webhooks.<workflowName>.secret`. The workflow definition must include
`trigger: { webhook: true }`.

**Signing (Node.js example):**

```js
const crypto = require("crypto");
const secret = "your-secret-here";
const rawBody = JSON.stringify({ ref: "refs/heads/main" });
const sig = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
// Set header: X-Kota-Webhook-Signature: <sig>
```

**Replay protection (optional):** Send the current Unix timestamp in milliseconds
as `X-Kota-Webhook-Timestamp`. When present, requests older than 5 minutes are
rejected with 401.

```
X-Kota-Webhook-Timestamp: 1743362400000
```

**Request body:** Optional JSON body. Sent as `body` in `stepOutputs.trigger`.

**Response (200):**

```json
{ "runId": "2026-03-30T21-00-00-000Z-my-workflow-abc123" }
```

**Error responses:**

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid `X-Kota-Webhook-Signature`, or stale `X-Kota-Webhook-Timestamp` |
| 404 | Workflow not found or has no `webhook: true` trigger |
| 409 | Workflow is already running |

**Trigger payload** available to steps as `stepOutputs.trigger`:

```json
{
  "body": { "ref": "refs/heads/main" },
  "headers": { "content-type": "application/json" },
  "timestamp": "2026-03-30T21:00:00.000Z"
}
```

**Configuration example** (`.kota/config.json`, keep gitignored):

```json
{
  "webhooks": {
    "my-workflow": { "secret": "your-secret-here" }
  }
}
```

**Workflow definition example:**

```ts
triggers: [{ webhook: true }]
```

## Session Endpoints

These endpoints let `kota serve` register and unregister interactive chat
sessions so the daemon is the single source of truth for live session state.

### GET /sessions

Returns all currently registered interactive sessions.

**Response:**

```json
{
  "sessions": [
    { "id": "a1b2c3d4", "createdAt": "2026-03-30T16:00:00.000Z", "lastActive": 1743350400000 }
  ]
}
```

### POST /sessions/register

Registers an interactive session with the daemon. Called by `kota serve` when
a new session is created.

**Request body:**

```json
{ "id": "a1b2c3d4", "createdAt": "2026-03-30T16:00:00.000Z" }
```

**Response:** `{ "ok": true }`

### DELETE /sessions/:id

Unregisters a session. Called by `kota serve` when a session is deleted or
the server shuts down.

**Response:** `204 No Content`

### GET /metrics

Returns daemon metrics in [Prometheus text exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/).
Suitable as a Prometheus scrape target.

**Response:** `text/plain; version=0.0.4; charset=utf-8`

```
# HELP kota_workflow_runs_total Lifetime workflow run counts by workflow and status
# TYPE kota_workflow_runs_total counter
kota_workflow_runs_total{workflow="builder",status="success"} 10
kota_workflow_runs_total{workflow="builder",status="failed"} 2
# HELP kota_workflow_cost_usd_total Cumulative agent spend in USD per workflow
# TYPE kota_workflow_cost_usd_total counter
kota_workflow_cost_usd_total{workflow="builder"} 1.5
# HELP kota_active_sessions_total Current number of active interactive sessions
# TYPE kota_active_sessions_total gauge
kota_active_sessions_total 1
# HELP kota_pending_approvals_total Current number of pending approval requests
# TYPE kota_pending_approvals_total gauge
kota_pending_approvals_total 0
# HELP kota_dispatch_paused 1 if workflow dispatch is paused, 0 otherwise
# TYPE kota_dispatch_paused gauge
kota_dispatch_paused 0
```

Metric families:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `kota_workflow_runs_total` | counter | `workflow`, `status` | Lifetime run counts by workflow and terminal status (`success`, `failed`, `interrupted`, etc.) |
| `kota_workflow_cost_usd_total` | counter | `workflow` | Cumulative agent spend in USD per workflow |
| `kota_active_sessions_total` | gauge | — | Current number of active interactive sessions |
| `kota_pending_approvals_total` | gauge | — | Current number of pending approval requests |
| `kota_dispatch_paused` | gauge | — | `1` if workflow dispatch is paused, `0` otherwise |

### Idle TTL and Sweep

Sessions are automatically removed by a periodic server-side sweep. A session
is considered stale once `now - lastActive > idleTtlMs`.

Defaults (configurable via `DaemonConfig`):
- `sessionIdleTtlMs`: `300_000` (5 minutes)
- `sessionSweepIntervalMs`: `60_000` (1 minute)

When a session is swept, the daemon emits a `session.unregistered` SSE event
(same as explicit `DELETE /sessions/:id`), so connected clients observe a clean
status update. Clients do not need to implement any heartbeat — the TTL is
enforced server-side only.

## Source Of Truth Boundary

When the daemon is running:

- Use the daemon control API for live status, history, approvals, and task state.
- `.kota/` files are persistence and audit evidence, not the live control surface.
- Run artifacts (`.kota/runs/`) are durable records that are valid to read
  directly; they are not live control state.

## Test Coverage

Integration tests for all endpoints live in
`src/scheduler/daemon-control.test.ts`. The test file uses a `makeHandle()`
stub pattern — no process spawning — and covers auth enforcement, each route's
success path, and error cases (404, 409, 401).

## Mobile Client Contract

A thin mobile client can implement full operator functionality using only this
API. The stable endpoints are:

- **Status**: `GET /status` — daemon health, active workflow sessions
- **Workflow control**: pause/resume/abort/reload/trigger, SSE events
- **Workflow run history**: `GET /workflow/runs` — recent run list; `GET /workflow/runs/:id` — step detail
- **History**: list, get, delete conversations
- **Approvals**: list pending, approve, reject
- **Task queue**: `GET /tasks` — full task state with priorities

All endpoints require the `Authorization: Bearer <token>` header. The token
and port are discovered from `.kota/daemon-control.json`.
