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
  ids derived from their directory roots. A scope is the only KOTA runtime
  identity; external systems may retain their own domain terminology.
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
Browser use, shell/process access, filesystem actions, agent-facing web access,
memory backends, MCP integration, operator surfaces, and provider-specific
data such as per-model token pricing should prefer module-owned capability
packs unless a shared runtime primitive truly has to stay in core. The
`CostTracker` primitive itself is core; the rate tables it queries through
the `model-pricing` provider seam belong to whichever module owns the
model client. Outbound HTTP request execution is one shared core primitive
because core protocols and modules both depend on its target, redirect,
credential, limit, redaction, retry, and telemetry policy; protocol adapters
and agent-facing web/browser behavior remain module-owned.

Scope registry identity, quiet-hours gating, crash-loop alerting, provider
registry state, approval queue state, and owner decision state are shared
daemon/runtime primitives and belong in `src/core/`.

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
- A cross-cutting runtime replacement is complete only after its task-declared
  production proof exercises the canonical composition roots, observes effects
  at the new owner, and shows the retired boundary is unreachable. Prefer
  behavioral proof at real boundaries over source scans or assertions tied to
  private phases.
- Autonomy uses the same `agent`, `workflow`, and `module` model as everything
  else. Do not add a second public automation engine beside workflows.
- Prefer one daemon control protocol over platform-specific side channels.
- Keep native UI wrappers thin. A macOS app or web dashboard should be a client
  of the daemon, not a second runtime host.

## Workflow Run Contract

Every validated workflow carries repository access: `none`, `read`, or
`write`. Writers also declare integration validation, and workflows declare
logical resources when domain work must be exclusive. Definitions describe
semantic work; they do not own private queue, claim, worktree, process, port,
commit, merge, or recovery mechanisms.

Run execution has one ownership chain:

- `RunStateDatabase` is the durable authority for admission and queue state,
  run and attempt ownership, logical resources, process identities, external
  effects, and terminal publications.
- `RunCoordinator` owns shared daemon admission, capacity, scope pause,
  cancellation, and child-run waits. A waiting parent releases capacity and
  reacquires it before continuing.
- `RunLifecycle` creates or adopts the run sandbox, allocates resources,
  executes the workflow, and drives writer finalization and cleanup.
- `IntegrationQueue` serializes writer publication. It reconciles a writer with
  the current canonical head, validates the reconciled result, and publishes
  only while holding the repository integration resource.

Conflict and validation repair are AI continuations inside runtime rails. The
runtime bounds and screens diagnostics, constrains conflict repairs to reported
paths, prevents agent-owned Git mutation, detects no-progress repeats, and
retains staging, rebase continuation, commit, publication, and terminal
disposition authority.

## Protocol Boundaries

- `tool` protocol: schema, runner, risk, and capability kind.
- `skill` protocol: scoped guidance entry point plus optional assets.
- `agent` protocol: role, defaults, skill list, tool policy, and ownership
  scope.
- `scope` protocol: stable id, display name, optional parent scope, optional
  directory root, and a registry projection. The daemon exposes a canonical
  scope projection; every control surface selects the same canonical identity.
- `daemon` protocol: lifecycle, ownership of runtime state, module loading,
  and control-plane hosting.
- `client` protocol: daemon discovery, capability-scoped control calls, and
  event subscription.
- `workflow` protocol: trigger, steps, retry/backoff, checks, and restart
  semantics.
- `channel` protocol: session routing, inbound/outbound transport, and operator
  identity.
- `module` protocol: contribution bundle for the concepts above.
- `outbound HTTP` protocol: named trust profile, bounded request/response, typed
  failure and retry disposition, plus redacted telemetry.
- `foreign module` protocol: an out-of-process module transport. Its exact
  message names, transport fields, scaffold details, and recovery behavior
  belong in the core module code, schema, examples, and focused tests rather
  than in a durable prose catalog.

## Concept Map

The architecture source of truth is the typed protocol plus this concise map.
Local source links point to representative contracts, not exhaustive catalogs.

| Concept | Canonical Mechanism | Boundary |
| --- | --- | --- |
| Scope | `ScopeRegistry`, `ScopeAuthorityService`, and `ScopedEventBus` in `src/core/daemon/` and `src/core/events/scope.ts`. | `scopeId` names every runtime boundary. The registry owns directory-scope identity and lifecycle; one machine-owned, revisioned authority transaction owns trust and policy. Repo config cannot write authority. |
| Event | `EventBus`, `BusEvents`, module event declarations, and durable `EventEnvelope` records in `src/core/events/`. | Payload shape is owned by the event declaration. Scoped events carry one `scopeId`; daemon-wide events omit scope. The bus is synchronous and in-process. The daemon SSE ring buffer in `src/core/daemon/event-ring-buffer.ts` is recent-event convenience; durable replay lives in the event journal. |
| Durable event data | `EventJournal` in `src/core/events/event-journal.ts` wraps emitted events with identity, scope lineage, causality, trace, idempotency, retention, and redacted projection metadata. | The journal records event occurrence and replay metadata. It does not replace the live bus, duplicate workflow run logs, or own future dedupe and dead-letter queue semantics. |
| Module | `KotaModule` in `src/core/modules/module-types.ts`. | Modules are the only integration unit. Provider-specific tools, workflows, channels, routes, setup requirements, effects, and stores stay module-owned. |
| Tool and action | `ToolDef` plus `ToolEffect` guardrail metadata. | External writes must be represented as typed tools or action adapters with explicit effect metadata; prose approval is not an execution contract. |
| Agent | `AgentDef` in `src/core/agents/agent-types.ts` plus workflow agent steps in `src/core/workflow/step-types.ts`. | Agent definitions declare role, prompt, model, effort, skills, tool policy, and write scope. Agent steps resolve through a harness; adapter-private options stay under the harness key. |
| Delegation | The `delegate` tool in `src/core/tools/delegate.ts`, the `handoff_agent` tool in `src/core/tools/handoff-agent.ts`, and workflow trigger chaining. | Agents can delegate through generic explore/execute/research modes, hand work to registered named agents with trace links and scoped tool/write policy, and chain workflow runs. |
| Prompt and skill | `SkillDef`, workflow prompt paths, and scoped `AGENTS.md` files. | Prompts guide roles; durable conventions belong in scoped docs or typed contracts. Do not encode new runtime mechanisms only in prompts. |
| Session | Core session runtime plus daemon session control routes. | Every interactive run and autonomous step runs in a session. Channels may own session pools; clients only observe or control sessions through the daemon API. |
| Automation, hook, schedule, workflow | `defineAutomation`, `defineHook`, workflow triggers, and workflow steps in `src/core/workflow/`. | Hook is an authoring view. Workflow is the compiled/runtime mechanism for event, schedule, interval, watch, webhook, and batch triggers. Do not add parallel trigger engines. |
| Channel | `ChannelDef` in `src/core/channels/channel.ts`. | Channels translate external I/O into sessions or typed inbound events. They are daemon-owned module contributions, not clients. |
| Client | Thin apps under `clients/` consuming the generated `KotaClient` aggregate, HTTP+JSON, SSE, and the shared UI surface graph. | Domain owners author wire types once; the daemon contract graph generates strict TypeScript and Swift projections. Clients render those contracts and never parse `.kota/` files or start a second runtime. |
| Setup, auth, and secrets | Module setup requirements in `src/core/modules/setup-requirements.ts` plus the secrets module. | Setup prompts collect prerequisites and secret references. Raw credentials stay in secret stores or provider auth flows, not decision records, prompts, screenshots, or client fixtures. |
| Outbound HTTP | `OutboundHttpTransport` and the closed profiles in `src/core/outbound-http/`. | Core protocols and module adapters select explicit trust profiles; only the low-level dispatcher reaches host HTTP primitives. Vendor payloads, OAuth semantics, and agent-facing web/browser behavior stay in their owning modules. |
| Owner question, approval, owner decision | `OwnerQuestionQueue`, `ApprovalQueue`, `OwnerDecisionStore`, `ownerDecisionSteps`, `confirmedOwnerActionStep`, and the owner-decisions module client/CLI/API. | Owner questions ask for judgment; approvals gate dangerous effects; owner decisions persist reusable choices and authorize at most the intended later action. |
| Store and evidence | Module-owned history, memory, knowledge, working memory, task, and run-artifact stores. | Git history and `.kota/runs/` are the review record. Do not create parallel changelogs, lesson stores, or ad hoc audit files. |
| Workflow run | `RunStateDatabase`, `RunCoordinator`, `RunLifecycle`, `RunSandboxManager`, and `IntegrationQueue` in `src/core/workflow/`. | Durable admission and ownership are shared across workflows and scopes. Repository isolation is per run; successful writers publish through one serialized integration path. Run artifacts are evidence, not a second queue or ownership store. |
| UI contribution | `KotaModule.uiSurfaces` declares side-effect-free live sources. One scope-aware module-runtime assembler projects and validates `ui.surface.v1` for both `/ui/surfaces` and `KotaClient.ui`; generated bindings project the graph into each native client. | Capability modules own their reads and surface semantics. Authored vectors cover only cross-field and operator behavior the structural schema cannot express. |

## Context Gathering

Agents should receive only the runtime facts they cannot reconstruct
themselves: trigger details, run identity, declared resource keys, and other
explicit workflow facts. Everything else should stay discoverable through
normal repo surfaces such as code, `data/`, docs, git history, `.kota/runs/`,
and external research tools.

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
and durable run state plus run artifacts remain the state and evidence records.

Use `defineAutomation` or `defineHook` only as authoring helpers. They compile
to ordinary workflow definitions before validation, scheduling, approvals,
run storage, and daemon/client APIs see them.
