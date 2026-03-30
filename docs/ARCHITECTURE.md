# Architecture

KOTA should expose a small set of public concepts and use one clear mechanism
for each job. New capability should fit into the existing model instead of
adding a parallel surface.

## Glossary

- `tool` = an explicit action with a schema and runner. Local tools, MCP tools,
  and external-service tools are all just tools.
- `skill` = reusable guidance plus optional supporting files or scripts. Repo
  `AGENTS.md` and `CLAUDE.md` files are scoped skills.
- `agent` = a named worker with a role, model defaults, skill set, tool scope,
  and write boundaries. `explorer`, `builder`, and `improver` are built-in
  agents.
- `daemon` = the long-lived runtime host. When running, it owns workflows,
  channels, sessions, stores, extension runtime state, and the control API.
- `session` = a stateful execution context for an agent. Interactive chats and
  autonomous agent steps both run in sessions.
- `workflow` = a deterministic trigger plus ordered steps. Hooks, cron jobs,
  standing orders, and autonomous loops are all workflows.
- `client` = an operator or user-facing app that talks to the daemon's control
  API. Daemon-backed CLI mode, native desktop apps, web apps, and mobile apps
  are clients.
- `channel` = a daemon-owned interaction surface that maps external input/output
  to sessions. Channels are not the same thing as clients: a client may inspect
  or control the daemon without being the transport that owns a conversation.
- `extension` = the only package and integration unit. An extension can
  contribute tools, skills, agents, workflows, channels, and internal services.
- `store` = a typed persistence unit in the runtime state subsystem. Store types
  are: history (conversation records), memory (agent notes), knowledge
  (structured reference entries), working memory (session scratchpad), and run
  artifacts (workflow execution evidence). See `docs/STORES.md`.

## Single Way

- Add a new action: add a `tool`.
- Add reusable repo guidance: add a `skill`.
- Add a specialist worker: add an `agent`.
- Add a long-lived runtime host capability: extend the `daemon`.
- Add automation: add a `workflow`.
- Add an operator or user-facing app: add a `client`.
- Add an external interaction transport: add a `channel`.
- Add or ship an integration: add an `extension`.

## Current To Target

- The module→extension migration is mostly complete, but not finished.
  Public APIs such as `extension_factory`, `getExtensionConfig`,
  `config.extensions`, and `src/extensions/` now use extension terminology.
  Some extension internals, diagnostics, and manifest-era helpers still carry
  module-era naming and should be cleaned up instead of treated as a permanent
  second vocabulary.
- `SkillDef` and `AgentDef` now exist, and built-in workflows invoke named
  agents. Skills are the one real reusable guidance path; `promptSection` has
  been removed.
- Workflows are the documented public automation surface, and workflow triggers
  now cover event, cron, interval, and idle work. Manifest-era `eventHandlers`
  and `scripts` have been removed. The `events` direct-subscription field has
  been removed from `KotaExtension`; automation uses contributed workflows.
- History, memory, working memory, knowledge, and run artifacts are now
  documented as stores in one runtime state subsystem (`docs/STORES.md`).
  They remain separate implementations sharing a provider registry, but the
  public model treats them as typed stores rather than many parallel products.
- The daemon exposes a loopback HTTP+JSON control API (`DaemonControlServer`
  in `src/scheduler/daemon-control.ts`). Live daemon and workflow status,
  history, approvals, and task queue all come from this API when the daemon is
  running. The HTTP server proxies all operator dashboard routes — Workflow,
  History, Approvals, Tasks — to the daemon control API, falling back to
  direct reads when offline. The daemon API surface is stable and documented
  in `docs/DAEMON-API.md`; it is sufficient for thin mobile or desktop clients
  to perform all common operator actions without bespoke server routes.
  Active workflow agent sessions are visible via `GET /status` (workflow.activeRuns).
  The daemon/client split is formalized for operator data: clients query the
  daemon API rather than reading `.kota/` files directly for live state.
  When the daemon is running, `kota serve` connects to it as a client: it
  registers and unregisters interactive sessions via the daemon control API
  (`POST /sessions/register`, `DELETE /sessions/:id`) so the daemon is the
  single source of truth for all live sessions. `GET /status` returns active
  interactive sessions alongside workflow active runs. `kota serve` skips
  starting its own disk-backed scheduler when the daemon is detected, falling
  back to standalone mode (own scheduler and session pool) when no daemon is
  running. See `docs/DAEMON-API.md`.
- `KotaExtension` now has a `channels` field following the same pattern as
  `workflows`, `tools`, and `agents`. A `ChannelDef` type in `src/channel.ts`
  captures the channel protocol: name, description, and a factory that receives
  a `ChannelStartContext` (projectDir, log, getWorkflowStatus) and returns a
  `ChannelAdapter`. The daemon collects contributed channels at startup, calls
  each factory, and manages lifecycle (start on daemon start, stop on shutdown).
  The Telegram status poll is contributed via the Telegram extension rather than
  hardcoded in daemon-subscriptions. A second extension can now add a channel
  (Slack, email, web chat) by declaring a `ChannelDef` without touching daemon
  internals.

## Protocol Boundaries

- `tool` protocol: schema, runner, risk, and capability kind.
- `skill` protocol: scoped guidance entry point plus optional assets.
- `agent` protocol: role, defaults, skill list, tool policy, and ownership
  scope.
- `daemon` protocol: lifecycle, ownership of runtime state, extension loading,
  and control-plane hosting.
- `client` protocol: daemon discovery, capability-scoped control calls, and
  event subscription.
- `workflow` protocol: trigger, steps, retry/backoff, checks, and restart
  semantics.
- `channel` protocol: session routing, inbound/outbound transport, and operator
  identity.
- `extension` protocol: contribution bundle for the concepts above.

## Context Gathering

Agents should receive only the runtime facts they cannot reconstruct
themselves: trigger details, run identity, claimed task ids, and other explicit
workflow facts. Everything else should stay discoverable through normal repo
surfaces such as code, tasks, docs, git history, `.kota/runs/`, and external
research tools.

Do not build a second orchestration layer out of pre-packaged summaries.
Prefer clear surfaces and self-directed investigation over injected worldview.

## Sessions And Channels

`session` is core. `AgentSession` owns the conversation, context, tools, and
lifecycle for every agent run — interactive or autonomous. Every path through
KOTA runs in a session. The `SessionStateMachine` enforces explicit lifecycle
states (idle → initializing → ready → thinking → acting → reflecting → closed).

The daemon should be the source of truth for live sessions when it is running.
Clients should query or control the daemon instead of reading session state
from `.kota/` files directly.

`channel` is optional. Channels manage pools of sessions on behalf of external
users (Telegram, daemon-backed web chat, future connectors). They live inside
the daemon and route traffic to sessions. Clients such as a native macOS app,
CLI daemon mode, web dashboard, or mobile app are not channels unless they also
own message routing for sessions.

`ChannelSession`, `ChannelAdapter`, and `ChannelDef` are defined in
`src/channel.ts`. `ChannelAdapter` is the runtime interface (`start`/`stop`);
`ChannelDef` is the extension contribution descriptor (name, description, and
a `create(ctx: ChannelStartContext)` factory). New channels should use these
types and be contributed via `KotaExtension.channels`.

## Migration Principles

- Prefer typed code protocols over parallel DSLs.
- Remove duplicate public surfaces instead of keeping aliases.
- Keep repo instructions scoped to the repo root; do not inherit parent-tree
  instructions by default.
- Make built-in autonomy use the same `agent`, `workflow`, and `extension`
  model as everything else.
- Do not add a second public automation engine beside workflows.
- Keep workflow-provided context thin. If an agent can discover something
  cheaply and reliably from the repo, the runtime should not inject it by
  default.
- Prefer one daemon control protocol over platform-specific side channels.
- Keep native UI wrappers thin. The macOS app should be a client of the daemon,
  not a second runtime host.

## External Anchors

- Claude Code hooks, settings, and sub-agents:
  - https://docs.anthropic.com/en/docs/claude-code/hooks-guide
  - https://docs.anthropic.com/en/docs/claude-code/settings
  - https://docs.anthropic.com/en/docs/claude-code/sub-agents
- OpenClaw concepts, sessions, heartbeat, and skills:
  - https://docs.openclaw.ai/concepts
  - https://docs.openclaw.ai/reference/session-management-compaction
  - https://docs.openclaw.ai/automation/cron-vs-heartbeat
  - https://docs.openclaw.ai/tools/creating-skills
- Codex skills and background automations:
  - https://openai.com/index/introducing-the-codex-app/
