# Scheduler

This directory contains schedule parsing, persistence, routing, and daemon-time scheduling behavior.

- Keep scheduling focused on time/event routing.
- Autonomous workflow execution belongs in workflow/runtime layers, not in ad hoc scheduler behavior.

## Key Modules

- `daemon.ts` — `Daemon` class; orchestration, state management, and public API.
- `config-reload-diff.ts` — `computeModuleConfigDiff(oldConfig, newConfig, allModules)`; computes which modules need reloading based on deep-equal diff of `modules.*` subtrees; returns `{ changedModules, isFullReload }`.
- `daemon-handle.ts` — `buildDaemonHandle(ctx)` factory; constructs the `DaemonControlHandle` object that bridges `Daemon` internals to `DaemonControlServer`; also exports `DaemonHandleContext` type.
- `daemon-logger.ts` — `DaemonLogger` class; structured stderr output in text or NDJSON format; reads format from constructor arg or `KOTA_DAEMON_LOG_FORMAT` env var.
- `daemon-control.ts` — `DaemonControlServer` class; HTTP server wiring, route dispatch, SSE, event ring buffer integration, authorization, and daemon-owned session pool integration (via `DaemonChatPool`). When `makeAgent` is provided in options, enables `POST /sessions`, `POST /sessions/:id/chat` for daemon-owned interactive sessions. Re-exports all public types from `daemon-control-types.ts`.
- `daemon-control-chat.ts` — `DaemonChatPool` class and route handlers for daemon-owned interactive sessions: `handleCreateDaemonSession`, `handleDaemonChat`, `deleteDaemonSession`, `readChatBody`. Intentionally avoids importing from `src/server/` to prevent circular dependencies.
- `event-ring-buffer.ts` — `EventRingBuffer` class; fixed-capacity circular buffer for recent daemon SSE events; supports `query(sinceMs?, limit?)` for catch-up reads.
- `daemon-control-types.ts` — all shared types for the control API: `DaemonControlHandle`, `DaemonLiveStatus`, `DaemonSseEvent`, `InteractiveSession` (with optional `source: "daemon" | "serve"` field), workflow run/status/definition types, `WorkflowMetricCounts`, `WorkflowDurationHistogramEntry`, and `CapabilityScope`.
- `daemon-control-utils.ts` — `jsonResponse` helper shared by route modules.
- `daemon-control-approvals.ts` — approval list, approve, and reject endpoint handlers.
- `daemon-control-sessions.ts` — session list, register, and unregister endpoint handlers.
- `daemon-control-workflow.ts` — workflow status, definitions, runs, pause/resume/abort/reload/trigger/enable/disable endpoint handlers; also handles `POST /reload` (config + module-contribution reload via `handleReloadConfig`).
- `daemon-control-history.ts` — history list, show, and delete endpoint handlers.
- `daemon-control-metrics.ts` — Prometheus metrics endpoint handler; exposes workflow run counts/costs, session and approval counts, dispatch-paused flag, per-workflow active-run gauge (`kota_workflow_active_runs`), total queue-depth gauge (`kota_workflow_queued_runs`), and run duration histogram (`kota_workflow_run_duration_seconds`) with fixed buckets (30s, 2m, 5m, 15m, 30m, 60m).
- `daemon-control-push-tokens.ts` — push token registration endpoint handler (`POST /push-tokens`).
- `push-tokens.ts` — `registerPushToken` (stores token in `.kota/push-tokens.json`), `sendPushNotifications` (fires Expo Push API when `approval.requested` emits). Payloads include `screen: "approvals"` and `approvalId` so the mobile client can deep-link to the specific approval; see `clients/mobile/AGENTS.md` for the full protocol.
- `daemon-control-webhook.ts` — inbound webhook trigger endpoint handler.
- `daemon-subscriptions.ts` — `subscribeDaemon`; sets up all event/bus/scheduler subscriptions and returns a single `unsubscribe()` function.
- `daemon-state.ts` — `DaemonState` type and assertion helper.
- `scheduler.ts` — `Scheduler` singleton; timer and bus connection logic.
- `scheduler-store.ts` — file I/O helpers for the Scheduler; reads/writes schedule JSON files, handles cleanup of excess fired and cancelled items.
- `schedule-parser.ts` — pure parsing, formatting, and type definitions for the scheduler; `ScheduledItem`, `parseTime`, `parseRepeat`, `matchesFilter`, `formatRelative`.
- `task-store.ts` — task persistence and lookup.
- `task-store-types.ts` — `Task`, `TaskPriority`, `TaskStatus`, and `TaskFileData` type declarations.
- `task-router.ts` — `routeTask`, `formatTaskHint`; exported `TaskType` and `TaskRoute` types.
- `task-router-data.ts` — `TASK_PATTERNS`, `STRATEGIES`, `GROUP_RECOMMENDATIONS`, and `PatternEntry` type; static data only.
- `session-sweep.ts` — `sweepExpiredSessions`; pure function that removes idle sessions from a `Map` and returns the expired IDs.
