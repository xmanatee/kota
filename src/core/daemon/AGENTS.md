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
- Modules extend the control API through `KotaModule.controlRoutes`, not by
  adding handlers under `src/core/daemon/`. Built-in and contributed routes
  share one `ControlRouteRegistration` shape (`method`, `path`,
  `capabilityScope`, `bypassAuth`, `handler`); the server merges them into
  one table and matches once per request — no parallel scope/handler/bypass
  tables. Built-in route closures bind their runtime state at registration
  time (see `daemon-control-routes.ts`), so the dispatcher stays free of
  route-specific dependencies. Route paths may include `:name` segments and
  collisions throw at server construction. Use this seam for any
  module-owned control-plane endpoint.
- Clients should use daemon client wrappers for URL construction, response
  decoding, authentication, polling, and live updates. They must not read
  daemon runtime files directly.
- Process-manager integration and operator CLI behavior belongs in the
  daemon-ops module; the daemon core owns the runtime host itself.

## Per-Concern Sibling Files

`daemon.ts` is a thin orchestrator. Lifecycle-time concerns live in
`daemon-*.ts` sibling phase files. `runDaemonShutdown` is the single
teardown body shared by normal stop and failed-start — do not fork it.
Named subsystems use a shared `<subsystem>-*.ts` prefix, one concern per
file: `daemon-chat-*` (bindings, pool, handlers) groups chat-session
lifecycle, distinct from the `daemon-control-*` control-plane wiring.

## Module Control-Plane Seams

Module-owned control routes live in their contributing module under
`#modules/<name>/routes.ts` (or `control-routes.ts`). Routes that need to
dispatch workflow runs, read live runtime state (counts, sessions,
paused/active/queued status), or read pre-dispatch policy from a workflow
definition use the `workflow-dispatcher`, `workflow-metrics-source`, and
`workflow-definitions` provider seams. The daemon registers all three at
startup so contributed handlers do not need a `DaemonControlHandle`.
Routes whose auth is carried in a per-request signature header rather than
the daemon Bearer token (today the webhook module's `/webhooks/:name`) opt
out of bearer-token middleware via `ControlRouteRegistration.bypassAuth`,
mirroring `RouteRegistration.bypassAuth`.

## Capability Readiness

Thin clients distinguish "daemon online but capability unavailable" from
"daemon offline" through `GET /capabilities`. The route aggregates
typed `CapabilityReadinessSource` entries that modules contribute through
the `CAPABILITY_READINESS_PROVIDER_TYPE` token from their own
`onLoad`. Each entry reports a stable `id` (e.g. `knowledge.search`),
status (`ready` | `unavailable` | `init_failed`), reason code, and short
operator-facing message. Adding a new capability is a registration in the
owning module — there is no central catalog. Duplicate ids and probe
exceptions surface as loud `init_failed` rows so wiring conflicts cannot
silently win. The daemon adds a `workflow.trigger` row directly because
workflow definitions are daemon-owned, not module-owned.

## Client Identity

`GET /identity` returns the `ClientIdentity` payload (project + daemon
identity, dashboard availability). `getClientIdentity()` resolves the
`dashboard` capability through the `/capabilities` readiness pipeline
and collapses it into the discriminated `ClientDashboardAvailability`
shape. Clients join `dashboard.path` onto the daemon base URL when
`available` is true; otherwise hide the control. See
`clients/AGENTS.md` for the contract.

## Multi-Project Runtime Shape

The daemon is single-project today. Once KOTA targets more than one project,
the owner must pick between two materially different runtime shapes. The
side-by-side variant comparison, migration shape, and follow-up decomposition
live in the pending task body at
`data/tasks/blocked/task-surface-project-selection-in-operator-clients-for-.md`.

## Recoverability

The daemon is the source of truth for live runtime state. A single question
governs every surface listed here: *if the daemon crashes mid-turn, does this
state reconstruct from append-only artifacts, or is it lost?*

Recoverable surfaces (append-only or file-backed; survive crash):

- **Daemon state** (`.kota/daemon-state.json`) — `completedRuns`, last-run
  fields, pid, startedAt. Written on every completion.
- **Workflow runtime** — run store (`.kota/runs/`), persisted queue, recovery
  record. Interrupted runs detected on startup and, when the worktree is
  dirty, `runtime.recovered` is queued first.
- **Scheduler** (`~/.kota/schedules-<hash>.json`) — persisted on every
  `add`, `cancel`, and `markFired`.
- **Approval queue** (`.kota/approvals/*.json`) — one file per approval,
  rewritten on every status transition.
- **Owner-question queue** (`.kota/owner-questions/*.json`) — one file per
  question, rewritten on every status transition.
- **Task store** (`data/tasks/`) — file-backed; unaffected by daemon crash.
- **Conversation history** (`~/.kota/history/`) — messages persist per
  `conversationId` via `ConversationHistory.save()`; the *conversation text*
  survives even when the daemon session that produced it is lost.
- **Daemon chat session bindings** (`.kota/daemon-chat-bindings.json`) —
  `sessionId → conversationId` map rewritten atomically on create/delete.
  After restart, `POST /sessions` with the prior `session_id` or
  `conversation_id` wakes a fresh `AgentSession` from history; the
  in-flight turn is lost.
- **Serve-registered session registry** — the daemon's registry is
  in-memory and cleared on crash, but the serve process owns the
  authoritative sessions. `DaemonLink` (`core/server/daemon-link.ts`)
  watches `.kota/daemon-control.json`; when it observes a new daemon
  identity (different `startedAt` or `token`), it rebuilds the daemon
  client and re-registers every live session via
  `POST /sessions/register`. Convergence happens within the fs-watch
  latency, or the fallback poll interval (5 s) when fs-watch misses the
  atomic rename.

Deliberate losses (state is not reconstructible, and persistence is not worth
the cost):

- **Event ring buffer** (in-memory, 500 events) — clients must tolerate a
  reconnect-window gap after daemon restart. SSE clients already reconnect;
  durable event history lives in run artifacts and module-log store. Adding
  write-through would duplicate every bus event to disk for a UI-catchup
  benefit clients already handle.
- **Notification-gate buffer** (held `workflow.attention.digest` events during
  quiet hours) — low volume, single event type, automatically released at
  window end. If the daemon crashes mid-window, the held digest is lost; the
  next real alert re-surfaces attention. Persisting this buffer would add a
  second store for a single event stream.
- **Workflow metric cache** (`daemon-handle.ts` memoization) —
  reconstructable by re-reading the run store on demand.
- **Module health-check cache** — refreshed on the next probe cycle (30 s).
- **SSE subscriptions and chat pool sweep timers** — transient; clients
  reconnect.

New daemon-owned runtime state must answer this question at design time.
Default to writing through to run artifacts or emitting a typed bus event
rather than holding state only in process memory. Do not introduce
session-state write-through on every event if a coarser checkpoint preserves
the wake-path guarantee.
