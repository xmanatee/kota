# Daemon Core

This directory contains the daemon host, control API, scheduler persistence,
and live runtime state.

- Keep daemon runtime ownership here: process lifecycle, control-plane hosting,
  session/channel hosting, scheduling, and runtime state.
- Autonomous workflow execution belongs in `src/core/workflow/`, not in ad hoc
  daemon behavior.
- The control API is a daemon-owned protocol. Exact routes, payload fields,
  event names, capability scopes, and status values belong in source, typed
  clients, and focused tests rather than durable docs.
- Clients should use daemon client wrappers for URL construction, response
  decoding, authentication, polling, and live updates. They must not read
  daemon runtime files directly.
- Process-manager integration and operator CLI behavior belongs in the
  daemon-ops module; the daemon core owns the runtime host itself.

## Internal Subdomains

- Daemon host: `daemon.ts`, `daemon-handle.ts`, `daemon-logger.ts`,
  `daemon-state.ts`, `daemon-subscriptions.ts`.
- Control API: `daemon-control.ts` (router), `daemon-control-types.ts`,
  `daemon-control-utils.ts`, and per-domain handlers
  (`daemon-control-approvals.ts`, `-chat.ts`, `-history.ts`, `-metrics.ts`,
  `-push-tokens.ts`, `-sessions.ts`, `-webhook.ts`, `-workflow.ts`).
- Scheduling: `scheduler.ts`, `scheduler-store.ts`, `schedule-parser.ts`.
- Task management: `task-store.ts`, `task-store-types.ts`, `task-router.ts`,
  `task-router-data.ts`.
- Daemon primitives: `approval-queue.ts`, `notification-gate.ts`,
  `event-ring-buffer.ts`, `push-tokens.ts`, `config-reload-diff.ts`,
  `module-crash-alert.ts`, `session-sweep.ts`.
