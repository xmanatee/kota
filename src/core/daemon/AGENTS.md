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

## Multi-Project Runtime Shape (Proposal)

The daemon is single-project today: `DaemonConfig.projectDir` is consumed once
at construction and every daemon-owned subsystem — scheduler, task store, run
store, module-log store, workflow runtime, notification gate, owner-question
queue, approval queue, event bus, push-token store, and every control-API
handler — binds to that one root. Once KOTA targets more than one project, the
owner needs to pick between two materially different runtime shapes. Both
satisfy the existing wording of
`task-surface-project-selection-in-operator-clients-for-`; only one can be the
durable answer. This section exists so the pick is informed.

### Variant A — daemon hosts many project runtimes

Durable ownership: the daemon becomes the multi-project host. It owns a
project registry (configured roots, their display name, and identity),
constructs a per-project runtime bundle (workflow runtime, run store, task
store, scheduler, module-log store, notification gate, approval queue,
owner-question queue, push-token store) inside one process, and routes every
bus event, session, run, owner question, approval, and push through a
`projectId` scope. Runtime state files move under `<projectDir>/.kota/`
per-project; nothing leaves the daemon process.

Attribution policy: every session, run, event, owner question, approval, and
scheduled item carries a `projectId`. The control-API surface gains project
scope as a first-class parameter on list/subscribe/mutate. Clients never stitch
attribution themselves.

Channel-to-project attachment: a channel adapter attaches to a project at
registration. Multi-project transports (e.g. Telegram bot, webhook channel)
resolve the target project per-message from typed identity metadata rather than
assuming one project per daemon. Channel identity remains project-scoped so
operator inputs cannot cross project boundaries.

Client impact: every client (CLI daemon mode, web, macOS, mobile) gains one
project-selector surface backed by the same control-API endpoints. Per-project
views are a filter on daemon output, not a bespoke per-client model.

Migration shape: the first PR registers the project-registry primitive, adds
`projectId` to every daemon-owned store and event payload, and threads scope
through the control API with a single default project preserving
KOTA-on-itself. Subsequent PRs land the CLI selector, the web selector, and
native client catch-up. Risk is high but one-directional: every subsystem that
binds to `projectDir` at construction needs a per-project factory; missing one
silently leaks cross-project state. Mitigation: add a typed invariant test that
scans for singleton store binding and fails if a new store forgets to declare
project scope.

### Variant B — one daemon per project, client-side registry

Durable ownership: the daemon stays single-project. Each project runs its own
daemon process with its own socket, state directory, and lifecycle. A
client-machine registry (shared across the operator's clients) maps projectId →
daemon address + token. Clients wrap the existing daemon control client with a
multi-daemon façade that fans out list/subscribe calls and merges responses.

Attribution policy: every session, run, event, owner question, and approval
stays unambiguous because each daemon owns exactly one project. The client is
responsible for tagging inbound responses with the projectId it fetched from,
and for keeping per-daemon SSE subscriptions isolated.

Channel-to-project attachment: channels stay single-project. Multi-project
transports that need to reach more than one daemon must either run a separate
bot/webhook per project or live outside the daemon entirely.

Client impact: every client carries the multi-daemon façade (connection pool,
registry reader, per-daemon token handling) and a project selector. The
registry is shared state across clients on one operator machine — clients read
it; the daemon does not own it. "Switch without restarting the daemon" means
switching the selected daemon socket, not restarting a process.

Migration shape: the first PR introduces the client registry format, the
multi-daemon client façade, and the CLI/web selector that drives it. The
daemon stays untouched. Risk is low for core but high for client surfaces: the
façade must handle unreachable daemons, token drift, and event fan-in without
leaking across projects. Mitigation: façade has a narrow typed interface
identical to the single-daemon client, with a project scope as the only added
parameter, and is covered by a fan-in test that asserts no event leaks across
sockets.

### Hybrid — daemon-owned registry, one active project

The daemon owns the registry file but runs exactly one project runtime at a
time. Switching tears down the current bundle and stands up the next one in
the same process. Does not deliver simultaneous supervision: operators cannot
watch two projects' queues at once. Not a long-term answer if the goal is
multi-project visibility; useful only as an intermediate step toward Variant A
if operator demand for simultaneous views is unclear.

### Follow-up decomposition (either variant)

Once the owner picks, the blocked task
`task-surface-project-selection-in-operator-clients-for-` splits into at least:

- **(a) Daemon-side project identity and attribution.** In Variant A: project
  registry primitive, per-project runtime bundle, `projectId` on every store,
  event, and API payload. In Variant B: project identity in the control-API
  startup report plus stable projectId generation so the client registry has
  something durable to key on.
- **(b) CLI daemon-mode selector.** Project-scoped views in `kota status`,
  `kota session`, `kota events`, and any daemon-ops readout. Both variants
  land in the daemon-ops module.
- **(c) Web client selector.** Project-scoped routes and SSE subscription
  scoping in the web dashboard. Native macOS and mobile parity follows as
  their own tasks.

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
- **Push-token store** (`.kota/push-tokens.json`) — rewritten on every
  registration.
- **Task store** (`data/tasks/`) — file-backed; unaffected by daemon crash.
- **Conversation history** (`~/.kota/history/`) — messages persist per
  `conversationId` via `ConversationHistory.save()`; the *conversation text*
  survives even when the daemon session that produced it is lost.

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

Gaps with live follow-ups (state is lost, loss is user-visible, and the fix
requires more than a write-through):

- **Daemon-owned chat sessions** (`DaemonChatPool`) — `AgentSession` +
  `ProxyTransport` live in daemon memory; on crash, the in-flight turn is
  abandoned and the session id cannot be reused by the client. Conversation
  messages persist (when `historyEnabled`), but the session→conversationId
  binding is not threaded through `makeAgent`, so there is no wake path.
  Follow-up: `task-persist-daemon-chat-session-conversation-binding`.
- **Serve-registered session registry** — the serve process registers each
  session with the daemon once at creation (`server-routes.ts`). After a
  daemon restart, the daemon's advisory registry is empty until the serve
  process makes the next per-session call. The conversation in serve memory
  survives, but daemon clients (e.g. `kota status`, web dashboard) cannot
  see it. Follow-up: `task-reregister-serve-sessions-after-daemon-restart`.

New daemon-owned runtime state must answer this question at design time.
Default to writing through to run artifacts or emitting a typed bus event
rather than holding state only in process memory. Do not introduce
session-state write-through on every event if a coarser checkpoint preserves
the wake-path guarantee.
