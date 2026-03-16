# Plan: Self-Hosting the Build/Improve Loop

## Context

The build/improve loop currently runs via external bash scripts (loop.sh, step.sh) that spawn Claude CLI sessions. The goal is to add infrastructure to KOTA so this loop can eventually run inside the framework itself. We're NOT migrating now — just adding the building blocks.

## What Exists

- **Scheduler**: Time-based only (`triggerAt` + `repeatMs`). No event triggers.
- **ActionExecutor**: Fire-and-forget. Creates agent sessions from scheduled items. No chaining.
- **AgentSession**: Request-response. No lifecycle events visible to other modules.
- **Transport**: Decouples agent I/O from frontends. Not used for internal coordination.
- **CLI**: `run`, `serve`, `telegram`. No daemon/long-running mode.
- **Plugins**: Extensible tools, but no way to define workflows or automations.

## What's Missing (4 pieces)

### 1. Event Bus
Internal pub/sub so modules can react to each other without direct coupling. Typed events (session.end, schedule.fire, action.complete, etc.). Ephemeral — no persistence, no replay. Singleton like other stores.

Needed so the scheduler, action executor, and daemon can coordinate.

### 2. Event-Based Triggers (extend Scheduler)
Scheduler currently only fires at a time. Extend it so items can also fire when a named event occurs on the bus. This lets users create automations like "when a session ends, run this prompt."

Backward compatible — existing time-based items unchanged.

### 3. Daemon Mode
A `kota daemon` CLI command that starts a long-running process hosting the event bus and scheduler. The daemon is an event-driven runtime, not a workflow sequencer.

Key behaviors:
- **Idle tasks**: When nothing else is happening, the daemon can run background tasks (like "self-build" steps). These are low-priority — any user request or scheduled action preempts them.
- **Event-driven reactions**: Actions triggered by events. The build/improve loop is just one pattern: "self-build" runs when idle → on completion, "self-improve" is triggered by the session.end event → on its completion, the cycle repeats via another event trigger.
- **Self-restart and recovery**: The daemon must be able to restart itself after code changes (the builder modifies src/ and rebuilds). Mechanism: the daemon detects that dist/ has been rebuilt, saves state, exits with a known "restart" exit code. A thin wrapper script (or process supervisor) restarts it. On startup, the daemon recovers in-progress state from persisted scheduler/task data and resumes.
- **Crash recovery**: On startup, check for incomplete state from a previous run. If a session was interrupted mid-task, log it and decide whether to retry or skip. Persist enough state that recovery is possible.
- **Graceful shutdown**: SIGINT/SIGTERM → stop accepting new tasks, wait for current session to finish (with a timeout), save state, exit.

### 4. Webhook / External Trigger Endpoints (extend HTTP server)
Add endpoints to the existing HTTP server so external systems can fire events on the bus:
- `POST /api/events/:name` — fire a custom event
- `GET /api/daemon/status` — daemon health, running tasks, pending schedules

This lets GitHub webhooks, CI systems, cron, etc. trigger KOTA actions.

## How the Build/Improve Loop Would Work

Not a rigid workflow — just event-driven triggers within the daemon:

1. Daemon starts, nothing in the queue → picks up the "self-build" idle task
2. Creates an AgentSession with the build-agent prompt, runs it
3. On completion → post-step: git commit, collect metrics
4. Emits `session.end` event on the bus
5. An event trigger fires: "on session.end where task=build-agent → run self-improve"
6. Creates an AgentSession with the improve-process prompt, runs it
7. On completion → post-step: git commit
8. If dist/ changed (builder rebuilt the code) → daemon self-restarts
9. Otherwise → back to idle → step 1

The "idle task" and "event trigger" concepts are general-purpose — they're not specific to the build/improve loop. Users could define their own idle tasks and event-triggered automations.

## Implementation Order

```
1. Event Bus (new module, no dependencies)
2. Extend Scheduler with event triggers (depends on 1)
3. Daemon mode with idle tasks, self-restart, recovery (depends on 1 & 2)
4. Webhook endpoints in HTTP server (depends on 1, nice-to-have)
```

Each piece is independently useful and shippable. The event bus helps plugins coordinate. Event triggers let users build automations. The daemon ties it together into a long-running runtime.

## Integration Points

- **AgentSession**: Emit session.start/session.end events on the bus (optional, only if bus is initialized)
- **ActionExecutor**: Emit action.complete on the bus
- **CLI**: Add `daemon` command following the pattern of `serve` and `telegram`
- **Server**: Add event/status endpoints

## Self-Restart Mechanism

The daemon needs to restart after the builder modifies and rebuilds the code. Design:

1. After each build-agent session, check if `dist/` was modified (compare mtime or hash before/after)
2. If changed: persist current state (iteration, pending triggers), exit with a special code (e.g., exit 75)
3. A wrapper (could be as simple as a while loop in bash, or systemd restart policy) detects exit 75 and restarts the daemon
4. On startup: daemon checks for persisted state, resumes where it left off

This keeps the daemon itself simple (no hot reload) while enabling continuous operation through restarts.

## What This Plan Does NOT Include

- Hot code reload within a running process (use restart instead)
- Rigid workflow engine / step sequencer (use event triggers instead)
- Distributed execution (single process)
- Visual editor for automations (JSON/config files, or the agent configures itself)

## Verification

The design is validated if:
1. The build/improve loop runs continuously via `kota daemon` without external scripts
2. The daemon self-restarts when the builder changes the code
3. Interrupting the daemon (Ctrl-C, crash, kill) and restarting it resumes correctly
4. External events (webhook, schedule) can trigger agent sessions
5. The idle-task mechanism is general enough for users to define their own background work
