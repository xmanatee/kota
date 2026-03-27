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
- `session` = a stateful execution context for an agent. Interactive chats and
  autonomous agent steps both run in sessions.
- `workflow` = a deterministic trigger plus ordered steps. Hooks, cron jobs,
  standing orders, and autonomous loops are all workflows.
- `channel` = an optional interaction surface that maps external input/output to
  sessions. CLI, web, and Telegram are channels. Channels are not required for
  autonomous workflows.
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
- Add automation: add a `workflow`.
- Add a human or external interface: add a `channel`.
- Add or ship an integration: add an `extension`.

## Current To Target

- `KotaModule`, plugins, and manifest modules have fully collapsed into the
  `extension` model. Public interfaces (`extension_factory`, `getExtensionConfig`),
  session internals, tool registry, and the `src/extensions/` directory are now
  consistently extension-named. The module→extension migration is complete.
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

## Protocol Boundaries

- `tool` protocol: schema, runner, risk, and capability kind.
- `skill` protocol: scoped guidance entry point plus optional assets.
- `agent` protocol: role, defaults, skill list, tool policy, and ownership
  scope.
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

`channel` is optional. Channels manage pools of sessions on behalf of external
users (web, Telegram). Each channel holds one `ChannelSession` per user/chat,
using `ProxyTransport` to route agent output to the right sink per request.
Autonomous workflow execution and CLI runs do NOT use channels.

`ChannelSession` and `ChannelAdapter` are defined in `src/channel.ts` and used
by both the HTTP server (`ManagedSession`) and the Telegram bot. This is the
shared channel session model — new channels should use the same types.

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
