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
  and write boundaries.
- `scope` = a daemon-hosted runtime context. The root scope is global;
  directory-backed scopes are the first concrete child scopes and use stable
  ids derived from their directory roots. Project is compatibility language for
  directory-backed scopes, not the core abstraction.
- `daemon` = the long-lived runtime host. When running, it owns workflows,
  channels, sessions, stores, module runtime state, and the control API.
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
- `module` = the only package and integration unit. A module can
  contribute tools, skills, agents, workflows, channels, and internal services.
- `store` = a typed persistence unit in the runtime state subsystem. Store types
  are: history (conversation records), memory (agent notes), knowledge
  (structured reference entries), working memory (session scratchpad), and run
  artifacts (workflow execution evidence).

## Single Way

- Add a new action: add a `tool`.
- Add reusable repo guidance: add a `skill`.
- Add a specialist worker: add an `agent`.
- Add runtime context identity: add or select a `scope`.
- Add a long-lived runtime host capability: extend the `daemon`.
- Add automation: add a `workflow`.
- Add an operator or user-facing app: add a `client`.
- Add an external interaction transport: add a `channel`.
- Add or ship an integration: add a `module`.

## Core Boundary

The core should stay small. It should mainly own:

- the agent/session loop
- tool and module protocols
- module loading and lifecycle
- workflow runtime and validation
- daemon control API and session/channel hosting
- guardrails and store/provider contracts

General-purpose capabilities should not accumulate in the core by default.
Browser use, shell/process access, filesystem actions, HTTP/web access,
memory backends, MCP integration, operator surfaces, and provider-specific
data such as per-model token pricing should prefer module-owned capability
packs unless a shared runtime primitive truly has to stay in core. The
`CostTracker` primitive itself is core; the rate tables it queries through
the `model-pricing` provider seam belong to whichever module owns the
model client.

Scope registry identity, quiet-hours gating, crash-loop alerting, provider
registry state, and approval queue state are shared daemon/runtime primitives
and belong in `src/core/`.

## Direction

- Workflow routing should stay definition-driven. A workflow that needs to
  participate in queue shaping, delivery, governance, recovery, or digest
  observation should declare that intent in its own definition. Other workflows
  should react to that declared intent or to generic events, not to a
  hardcoded workflow-name list.
- Notification callers emit typed bus events rather than calling transports
  directly. Modules subscribe and unsubscribe through their normal lifecycle.
- Modules can register per-turn system-prompt state contributors through the
  module context. This is the correct pattern for injecting module-owned state
  without creating a direct core-to-module import.
- Prefer typed code protocols over parallel DSLs.
- Prefer strict protocols over permissive coercion. Internal malformed data
  should fail loudly; adapters at external boundaries should normalize once and
  expose explicit typed results.
- Remove duplicate public surfaces instead of keeping aliases.
- Autonomy uses the same `agent`, `workflow`, and `module` model as everything
  else. Do not add a second public automation engine beside workflows.
- Prefer one daemon control protocol over platform-specific side channels.
- Keep native UI wrappers thin. A macOS app or web dashboard should be a client
  of the daemon, not a second runtime host.

## Protocol Boundaries

- `tool` protocol: schema, runner, risk, and capability kind.
- `skill` protocol: scoped guidance entry point plus optional assets.
- `agent` protocol: role, defaults, skill list, tool policy, and ownership
  scope.
- `scope` protocol: stable id, display name, optional parent scope, optional
  directory root, and a registry projection. The daemon exposes a canonical
  scope projection; project-named control surfaces are compatibility adapters
  for directory-backed scopes.
- `daemon` protocol: lifecycle, ownership of runtime state, module loading,
  and control-plane hosting.
- `client` protocol: daemon discovery, capability-scoped control calls, and
  event subscription.
- `workflow` protocol: trigger, steps, retry/backoff, checks, and restart
  semantics.
- `channel` protocol: session routing, inbound/outbound transport, and operator
  identity.
- `module` protocol: contribution bundle for the concepts above.
- `foreign module` protocol: an out-of-process module transport. Its exact
  message names, transport fields, scaffold details, and recovery behavior
  belong in the core module code, schema, examples, and focused tests rather
  than in a durable prose catalog.

## Context Gathering

Agents should receive only the runtime facts they cannot reconstruct
themselves: trigger details, run identity, claimed task ids, and other explicit
workflow facts. Everything else should stay discoverable through normal repo
surfaces such as code, `data/`, docs, git history, `.kota/runs/`, and external
research tools.

Do not build a second orchestration layer out of pre-packaged summaries.
Prefer clear surfaces and self-directed investigation over injected worldview.

## Sessions And Channels

`session` is core. The session runtime owns the conversation, context, tools,
and lifecycle for every agent run, interactive or autonomous. Every path
through KOTA runs in a session with an explicit lifecycle.

When the daemon is running, it is the source of truth for live sessions.
`kota serve` registers and unregisters interactive sessions with the daemon so
all live state is visible via a single control API. Clients query the daemon
instead of reading session state from `.kota/` files directly.

`channel` is optional. Channels manage pools of sessions on behalf of external
users (Telegram, daemon-backed web chat, future connectors). They live inside
the daemon and route traffic to sessions. Clients such as a native macOS app,
CLI daemon mode, web dashboard, or mobile app are not channels unless they also
own message routing for sessions.

New channels should use the channel protocol and be contributed by modules.

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
