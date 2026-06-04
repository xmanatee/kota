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
- `prompt` = instruction text used by an agent, workflow step, skill, or
  harness adapter. Prompts are artifacts, not runtime identity.
- `harness` = the adapter that executes an agent step against a provider or
  local runner. Harness-specific options stay adapter-private.
- `scope` = a daemon-hosted runtime context. The root scope is global;
  directory-backed scopes are the first concrete child scopes and use stable
  ids derived from their directory roots. Project is compatibility language for
  directory-backed scopes, not the core abstraction.
- `daemon` = the long-lived runtime host. When running, it owns workflows,
  channels, sessions, stores, module runtime state, and the control API.
- `session` = a stateful execution context for an agent. Interactive chats and
  autonomous agent steps both run in sessions.
- `automation` = an operator- or module-authored reaction with one or more
  triggers and ordered steps.
- `hook` = an automation whose name emphasizes the thing it reacts to: a typed
  event, schedule tick, file watch, webhook, or future batch trigger.
- `workflow` = the durable compiled/runtime representation of an automation.
  Workflow definitions and runs are the single execution engine for hooks, cron
  jobs, standing orders, and autonomous loops.
- `trigger` = the condition or producer that queues a workflow run: typed
  event, cron schedule, interval, file watch, webhook, or a trigger step.
- `schedule` = a trigger producer. Schedules are not agent properties.
- `step` = an ordered executor inside a workflow: code, agent, tool, approval,
  await-event, emit, trigger, parallel, branch, or foreach.
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
- `setup requirement` = a module-declared config, secret, OAuth, browser
  profile, external URL, or capability prerequisite that clients can render and
  satisfy without exposing secret values to agents.
- `owner decision` = a durable owner choice that can resume a workflow or
  authorize a later action. It is distinct from a one-off owner question and
  from tool-call approval.

## Single Way

- Add a new action: add a `tool`.
- Add reusable repo guidance: add a `skill`.
- Add a specialist worker: add an `agent`.
- Add runtime context identity: add or select a `scope`.
- Add a long-lived runtime host capability: extend the `daemon`.
- Add automation: author an automation or hook that compiles to a `workflow`.
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

## Concept Map

The architecture source of truth is the typed protocol plus this concise map.
Local source links point to representative contracts, not exhaustive catalogs.

| Concept | Canonical Mechanism | Boundary |
| --- | --- | --- |
| Scope and project | `ScopeRegistry` and `ProjectScopedEventBus` in `src/core/daemon/scope-registry.ts` and `src/core/events/project-scope.ts`. | `scopeId` is canonical. `projectId`, `/projects`, and project route parameters are compatibility language for directory-backed scopes. |
| Event | `EventBus`, `BusEvents`, and module event declarations in `src/core/events/`. | Payload shape is owned by the event declaration. Scope-scoped events carry `scopeId` plus compatibility `projectId`; daemon-wide events omit scope. The bus is synchronous and in-process. The daemon SSE ring buffer in `src/core/daemon/event-ring-buffer.ts` is recent-event convenience, not durable replay. |
| Durable event data | Future `EventEnvelope`, event schema registry, journal, idempotency, and dead-letter queue tasks. | Do not overload the live bus with audit, replay, dedupe, or retention semantics. |
| Module | `KotaModule` in `src/core/modules/module-types.ts`. | Modules are the only integration unit. Provider-specific tools, workflows, channels, routes, setup requirements, effects, and stores stay module-owned. |
| Tool and action | `ToolDef` plus `ToolEffect` guardrail metadata. | External writes must be represented as typed tools or action adapters with explicit effect metadata; prose approval is not an execution contract. |
| Agent | `AgentDef` in `src/core/agents/agent-types.ts` plus workflow agent steps in `src/core/workflow/step-types.ts`. | Agent definitions declare role, prompt, model, effort, skills, tool policy, and write scope. Agent steps resolve through a harness; adapter-private options stay under the harness key. |
| Delegation | The `delegate` tool in `src/core/tools/delegate.ts` and workflow trigger chaining. | Agents can delegate through generic explore/execute/research modes, and workflows can chain runs. First-class named-agent handoff remains a separate protocol gap. |
| Prompt and skill | `SkillDef`, workflow prompt paths, and scoped `AGENTS.md` files. | Prompts guide roles; durable conventions belong in scoped docs or typed contracts. Do not encode new runtime mechanisms only in prompts. |
| Session | Core session runtime plus daemon session control routes. | Every interactive run and autonomous step runs in a session. Channels may own session pools; clients only observe or control sessions through the daemon API. |
| Automation, hook, schedule, workflow | `defineAutomation`, `defineHook`, workflow triggers, and workflow steps in `src/core/workflow/`. | Hook is an authoring view. Workflow is the compiled/runtime mechanism for event, schedule, interval, watch, webhook, and batch triggers. Do not add parallel trigger engines. |
| Channel | `ChannelDef` in `src/core/channels/channel.ts`. | Channels translate external I/O into sessions or typed inbound events. They are daemon-owned module contributions, not clients. |
| Client | Thin apps under `clients/` consuming `KotaClient`, HTTP+JSON, and SSE. | Clients render daemon contracts and never parse `.kota/` files or start a second runtime. The shared UI contribution protocol is the intended renderer contract; until it lands, conformance fixtures keep wire shapes aligned. |
| Setup, auth, and secrets | Module setup requirements in `src/core/modules/setup-requirements.ts` plus the secrets module. | Setup prompts collect prerequisites and secret references. Raw credentials stay in secret stores or provider auth flows, not decision records, prompts, screenshots, or client fixtures. |
| Owner question, approval, owner decision | `OwnerQuestionQueue`, `ApprovalQueue`, workflow approval steps, and the persisted owner-confirmed action task. | Owner questions ask for judgment; approvals gate tool calls; owner decisions must persist reusable choices and authorize at most the intended later action. |
| Store and evidence | Module-owned history, memory, knowledge, working memory, task, and run-artifact stores. | Git history and `.kota/runs/` are the review record. Do not create parallel changelogs, lesson stores, or ad hoc audit files. |
| UI contribution | Planned typed UI tree rendered by CLI, web, Apple, and mobile clients. | Operator-facing forms, actions, status, setup, approvals, owner requests, runs, and module capabilities should be declared once and rendered natively by each client. |

## Scenario Matrix

Open gaps are tracked by normalized tasks; this matrix explains the
architecture fit without becoming a second queue.

| Scenario | Expression Today | Gap | Normalized Task |
| --- | --- | --- | --- |
| Multi-scope continuous improvement | Directory-backed scopes, scoped events/stores, and the `scope-improver` automation can observe scope-local instructions, tasks, run artifacts, and changes. | Hierarchical scope policy is still shallow when parent/child scopes need inherited autonomy and write rules. | `data/tasks/done/task-add-continuous-scope-improvement-automation.md`; `data/tasks/backlog/task-add-scope-policy-inheritance-protocol.md`. |
| Weekly meta-review | Workflow schedules and generic batching can trigger the progress reviewer over scoped run, task, message, and artifact windows. | Durable replay across daemon restarts still depends on event journaling instead of the live bus. | `data/tasks/done/task-add-scope-progress-reviewer-automation.md`; `data/tasks/backlog/task-add-durable-event-envelope-and-journal.md`. |
| Telegram blocked or archived source handling | Telegram and other adapters can emit normalized inbound signals and owner/approval messages through module events. | Routing, source trust/status, and blocked-source no-op behavior are still adapter-specific, and Telegram intake is text-first. | `data/tasks/backlog/task-add-declarative-inbound-signal-routing-for-channel.md`; `data/tasks/backlog/task-expand-telegram-signals-beyond-text-messages.md`. |
| Telegram sports availability with schedule matching | Inbound signals, generic event batches, setup/auth requirements, owner questions, and provider tools are composable workflow pieces. | A reference workflow still needs routing rules, calendar availability lookup, owner confirmation, and provider-specific booking/reply/reaction actions. | `data/tasks/backlog/task-add-channel-opportunity-matching-reference-workflo.md`; `data/tasks/ready/task-add-persisted-owner-confirmed-action-protocol.md`. |
| Confirmation-to-booking flow | Owner questions and approvals can ask and gate one tool call. Setup/auth requirements separate credential collection from agent context. | Durable owner choice, duplicate-consumption rejection, dry-run/action metadata, and provider-specific confirmed action adapters are missing. | `data/tasks/ready/task-add-persisted-owner-confirmed-action-protocol.md`; `data/tasks/backlog/task-add-generic-idempotency-and-dedupe-protocol.md`. |
| High-volume event batching with staged model passes | Workflow trigger batching supports scoped buffers, grouping, count/time/idle flushes, and batch payloads for cheap-first workflow stages. | Event schemas, durable envelopes, DLQ, capability/effect manifests, and compiled explain output are needed for simulation, replay, audit, and client inspection. | `data/tasks/done/task-add-generic-event-batching-to-workflow-triggers.md`; `data/tasks/backlog/task-add-event-schema-version-registry.md`; `data/tasks/backlog/task-add-durable-event-envelope-and-journal.md`; `data/tasks/backlog/task-add-dead-letter-queue-for-poisoned-events-and-batc.md`; `data/tasks/backlog/task-add-module-capability-and-effect-manifest.md`; `data/tasks/backlog/task-add-compiled-automation-graph-explain-api.md`. |
| Progress review by task count or message count | Progress reviewer plus workflow batching can review bounded windows by schedule, count, or event batch. | Message-count review needs durable channel/event history when live buffers are insufficient or a daemon restart occurs. | `data/tasks/done/task-add-scope-progress-reviewer-automation.md`; `data/tasks/backlog/task-add-durable-event-envelope-and-journal.md`. |

Known current gaps that affect the scenarios are: project terminology remains
as compatibility language on some routes and client code; event replay is not
durable beyond the live bus and fixed-size SSE ring buffer; Telegram signal
intake is still text-heavy; some credentials still flow through env/config
before every module has setup declarations; the richer daemon-backed CLI is
still behind `kota navigate` until the shared UI contribution protocol and
default CLI client work land.

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

## Automation Model

KOTA differs from Temporal by not exposing a separate workflow/activity/message
programming model: KOTA steps are the executor boundary, and event delivery
uses the daemon event bus plus workflow triggers. KOTA differs from Home
Assistant by not making trigger/condition/action a separate automation engine:
conditions are workflow predicates or branch steps, actions are workflow steps,
and the workflow run store remains the execution record.

Use `defineAutomation` or `defineHook` only as authoring helpers. They compile
to ordinary workflow definitions before validation, scheduling, approvals,
run storage, and daemon/client APIs see them.

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
- Temporal workflows and message passing:
  - https://docs.temporal.io/workflows
  - https://docs.temporal.io/develop/typescript/workflows/message-passing
- Home Assistant automations and config flows:
  - https://www.home-assistant.io/docs/automation/trigger/
  - https://developers.home-assistant.io/docs/core/integration/config_flow/
- Node-RED message design:
  - https://nodered.org/docs/developing-flows/message-design
- JSON Forms architecture:
  - https://jsonforms.io/docs/architecture/
- Backstage frontend plugins and extensions:
  - https://backstage.io/docs/frontend-system/architecture/plugins/
- Terminal and client UI references:
  - https://github.com/vadimdemedes/ink
  - https://github.com/charmbracelet/bubbletea
  - https://textual.textualize.io/
- MCP elicitation:
  - https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
