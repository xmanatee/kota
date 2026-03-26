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

## Single Way

- Add a new action: add a `tool`.
- Add reusable repo guidance: add a `skill`.
- Add a specialist worker: add an `agent`.
- Add automation: add a `workflow`.
- Add a human or external interface: add a `channel`.
- Add or ship an integration: add an `extension`.

## Current To Target

- ~~`KotaModule`, plugins, and manifest modules should collapse into one
  `extension` model.~~ Done: `KotaExtension` is now the single extension
  protocol. All loading paths (built-ins, plugins, npm packages, manifests)
  go through `ExtensionLoader`. See `src/extension-types.ts`.
- Module `promptSection`, repo instruction files, and workflow-only guidance
  should collapse into a single `skill` model.
- `explorer`, `builder`, and `improver` should remain workflows, but their
  worker identity should be first-class `agent` definitions instead of prompt
  files plus ad hoc conventions.
- Scheduler events, hook-like reactions, cron triggers, heartbeat work, and
  standing orders should remain one `workflow` surface instead of growing a
  second hook engine.
- History, memory, working memory, knowledge, and run artifacts should be
  treated as stores inside one runtime state subsystem, not as many separate
  product-level concepts.

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

## Sessions And Channels

`session` is core. KOTA already has persistent interactive sessions, server
sessions, Telegram chats, and autonomous agent-step sessions.

`channel` should be optional. Claude Code's core model centers on project
instructions, hooks, skills, and sub-agents, not on channels. OpenClaw adds
channels because it is a multi-transport gateway. KOTA should treat channels as
extensions for interactive surfaces, not as a mandatory abstraction for every
runtime path.

## Migration Principles

- Prefer typed code protocols over parallel DSLs.
- Remove duplicate public surfaces instead of keeping aliases.
- Keep repo instructions scoped to the repo root; do not inherit parent-tree
  instructions by default.
- Make built-in autonomy use the same `agent`, `workflow`, and `extension`
  model as everything else.
- Do not add a second public automation engine beside workflows.

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
