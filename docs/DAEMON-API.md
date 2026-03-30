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
  `GET /status`, `GET /workflow/status`, `GET /events`,
  `GET /history`, `GET /history/:id`, `GET /approvals`, `GET /tasks`
- **`control`** — mutate workflow dispatch and data:
  `POST /workflow/pause`, `POST /workflow/resume`, `POST /workflow/abort`,
  `POST /workflow/reload`, `POST /workflow/trigger`,
  `DELETE /history/:id`, `POST /approvals/:id/approve`,
  `POST /approvals/:id/reject`

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
sessions. Each entry represents a live daemon session.

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

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event types:**

| Event type                | When emitted                                      |
|---------------------------|---------------------------------------------------|
| `workflow.started`        | A workflow run begins                             |
| `workflow.completed`      | A workflow run finishes (success, failed, etc.)   |
| `workflow.step.completed` | An individual workflow step finishes              |
| `queue.changed`           | After `workflow.started` or `workflow.completed`  |

Each event is formatted as standard SSE:

```
event: workflow.started
data: {"workflow":"builder","runId":"2026-03-28T...","triggerEvent":"runtime.idle",...}

```

`DaemonControlClient.events()` returns an `AsyncGenerator<DaemonSseEvent>` that
subscribes to this endpoint. Web clients can use the proxied
`GET /api/daemon/events` route on the HTTP server instead.

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
      "status": "pending"
    }
  ]
}
```

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
| POST /api/workflow/reload           | POST /workflow/reload         |
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

Queuing a workflow (`POST /api/workflow/trigger`) writes directly to the
persistent run queue in `.kota/workflow-state.json`, which the daemon polls.
Run artifacts in `.kota/runs/` are durable evidence and are read directly by
the server for run listing and streaming.

## Source Of Truth Boundary

When the daemon is running:

- Use the daemon control API for live status, history, approvals, and task state.
- `.kota/` files are persistence and audit evidence, not the live control surface.
- Run artifacts (`.kota/runs/`) are durable records that are valid to read
  directly; they are not live control state.

## Mobile Client Contract

A thin mobile client can implement full operator functionality using only this
API. The stable endpoints are:

- **Status**: `GET /status` — daemon health, active workflow sessions
- **Workflow control**: pause/resume/abort/reload/trigger, SSE events
- **History**: list, get, delete conversations
- **Approvals**: list pending, approve, reject
- **Task queue**: `GET /tasks` — full task state with priorities

All endpoints require the `Authorization: Bearer <token>` header. The token
and port are discovered from `.kota/daemon-control.json`.
