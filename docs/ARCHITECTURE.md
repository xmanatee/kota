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
  production proof exercises live and restart/recovery ingress through the
  canonical composition roots, observes traffic at the new owner, and shows
  the retired boundary is unreachable. Each claimed effect is bound to an exact
  passing assertion from the declared production test execution. Each binding
  is rerun alone and must produce assertion-scoped runtime coverage for its
  declared non-test production entrypoints; hand-authored pass flags and
  assertion names that never load production code are not evidence. Focused
  component tests remain useful but cannot substitute for adoption proof at
  the assembly boundary.
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
| Scope and project | `ScopeRegistry`, `ScopeAuthorityService`, and `ProjectScopedEventBus` in `src/core/daemon/` and `src/core/events/project-scope.ts`. | `scopeId` is canonical. The registry owns identity/lifecycle; one machine-owned, revisioned authority transaction owns trust and policy. Repo config cannot write authority. `projectId`, `/projects`, and project route parameters are compatibility language for directory-backed scopes. |
| Event | `EventBus`, `BusEvents`, module event declarations, and durable `EventEnvelope` records in `src/core/events/`. | Payload shape is owned by the event declaration. Scope-scoped events carry `scopeId` plus compatibility `projectId`; daemon-wide events omit scope. The bus is synchronous and in-process. The daemon SSE ring buffer in `src/core/daemon/event-ring-buffer.ts` is recent-event convenience; durable replay lives in the event journal. |
| Durable event data | `EventJournal` in `src/core/events/event-journal.ts` wraps emitted events with identity, scope lineage, causality, trace, idempotency, retention, and redacted projection metadata. | The journal records event occurrence and replay metadata. It does not replace the live bus, duplicate workflow run logs, or own future dedupe and dead-letter queue semantics. |
| Module | `KotaModule` in `src/core/modules/module-types.ts`. | Modules are the only integration unit. Provider-specific tools, workflows, channels, routes, setup requirements, effects, and stores stay module-owned. |
| Tool and action | `ToolDef` plus `ToolEffect` guardrail metadata. | External writes must be represented as typed tools or action adapters with explicit effect metadata; prose approval is not an execution contract. |
| Agent | `AgentDef` in `src/core/agents/agent-types.ts` plus workflow agent steps in `src/core/workflow/step-types.ts`. | Agent definitions declare role, prompt, model, effort, skills, tool policy, and write scope. Agent steps resolve through a harness; adapter-private options stay under the harness key. |
| Delegation | The `delegate` tool in `src/core/tools/delegate.ts`, the `handoff_agent` tool in `src/core/tools/handoff-agent.ts`, and workflow trigger chaining. | Agents can delegate through generic explore/execute/research modes, hand work to registered named agents with trace links and scoped tool/write policy, and chain workflow runs. |
| Prompt and skill | `SkillDef`, workflow prompt paths, and scoped `AGENTS.md` files. | Prompts guide roles; durable conventions belong in scoped docs or typed contracts. Do not encode new runtime mechanisms only in prompts. |
| Session | Core session runtime plus daemon session control routes. | Every interactive run and autonomous step runs in a session. Channels may own session pools; clients only observe or control sessions through the daemon API. |
| Automation, hook, schedule, workflow | `defineAutomation`, `defineHook`, workflow triggers, and workflow steps in `src/core/workflow/`. | Hook is an authoring view. Workflow is the compiled/runtime mechanism for event, schedule, interval, watch, webhook, and batch triggers. Do not add parallel trigger engines. |
| Channel | `ChannelDef` in `src/core/channels/channel.ts`. | Channels translate external I/O into sessions or typed inbound events. They are daemon-owned module contributions, not clients. |
| Client | Thin apps under `clients/` consuming `KotaClient`, HTTP+JSON, SSE, and the shared UI surface graph. | Clients render daemon contracts and never parse `.kota/` files or start a second runtime. The shared UI contribution protocol is the renderer contract for operator-facing controls that should appear consistently across clients. |
| Setup, auth, and secrets | Module setup requirements in `src/core/modules/setup-requirements.ts` plus the secrets module. | Setup prompts collect prerequisites and secret references. Raw credentials stay in secret stores or provider auth flows, not decision records, prompts, screenshots, or client fixtures. |
| Outbound HTTP | `OutboundHttpTransport` and the closed profiles in `src/core/outbound-http/`. | Core protocols and module adapters select explicit trust profiles; only the low-level dispatcher reaches host HTTP primitives. Vendor payloads, OAuth semantics, and agent-facing web/browser behavior stay in their owning modules. |
| Owner question, approval, owner decision | `OwnerQuestionQueue`, `ApprovalQueue`, `OwnerDecisionStore`, `ownerDecisionSteps`, `confirmedOwnerActionStep`, and the owner-decisions module client/CLI/API. | Owner questions ask for judgment; approvals gate dangerous effects; owner decisions persist reusable choices and authorize at most the intended later action. |
| Store and evidence | Module-owned history, memory, knowledge, working memory, task, and run-artifact stores. | Git history and `.kota/runs/` are the review record. Do not create parallel changelogs, lesson stores, or ad hoc audit files. |
| Workflow recovery and worktrees | Workflow state recovery projects task claims, worktree metadata, Git worktree state, DLQ records, task files, and run metadata into one disposition. Automation worktree lifecycle reconciliation lives in `reconcileAutomationWorktrees(projectDir)` in the Git module; status rendering stays read-only and operator cleanup commands call that same reconciler. Workflow-owned terminal finalizers may clean up unambiguous failed or interrupted worktrees; ambiguous evidence is preserved for review. | Each source keeps a narrow job: claims own ownership/lease, worktree metadata owns workspace lifecycle, DLQ owns failed dispatch records, task markdown owns product task state, run metadata owns execution evidence, and the recovery projection owns cross-store decisions. |
| UI contribution | `KotaModule.uiSurfaces` declares side-effect-free live sources. One scope-aware module-runtime assembler projects and validates `ui.surface.v1` for both `/ui/surfaces` and `KotaClient.ui`; shared conformance fixtures and native decoders consume that graph. | Capability modules own their reads and surface semantics. Operator-facing forms, actions, status, setup, approvals, owner requests, runs, launch controls, and module capabilities are declared once and rendered natively by each client. Typed actions carry parameter schemas, readiness, effects, confirmation metadata, and result/error contracts. Surfaces declare the domain events that refresh their projection, while log-stream nodes additionally identify which live event payloads clients append to that stream. |

## Scenario Matrix

Open gaps are tracked by normalized tasks; this matrix explains the
architecture fit without becoming a second queue.

| Scenario | Expression Today | Gap | Normalized Task |
| --- | --- | --- | --- |
| Multi-scope continuous improvement | Directory-backed scopes, scoped events/stores, and resolved scope policies expose scope-local instructions, tasks, run artifacts, and inherited autonomy rules. Successful live registration reserves and emits one fingerprinted initial `scope-improver` request; explicit requests and material durable guidance/resolved-policy changes are the only later boundaries. Canonical pre-queue admission rejects consumed or superseded inputs, dirty automatic input remains pending for cleanup redelivery, and builder owns source edits. | Remaining gaps are onboarding posture/readiness explanation, setup gating, scenario-specific render coverage, and retention policy consumers, not semantic activation or a periodic evidence scan. | `data/tasks/backlog/task-activate-continuous-improvement-for-newly-onboarde.md`; `data/tasks/done/task-add-continuous-scope-improvement-automation.md`; `data/tasks/done/task-add-scope-policy-inheritance-protocol.md`; `data/tasks/done/task-add-shared-ui-contribution-protocol-across-clients.md`. |
| Semantic meta-review | Dispatcher recognizes committed strategic task transitions and resolved owner decisions, assigns one monotonic input revision, and emits it through an automatic latest-only progress-review event. Explicit requests use a separate lossless event, so neither delivery class can replace the other. Canonical pre-queue admission rejects consumed/superseded revisions, while a dirty automatic run parks the input with a fresh delivery attempt for cleanup redelivery. The reviewer reads the full canonical open queue plus issue, recovery, and owner-decision refs; schedules and normal build traffic do not invoke it. | Client surfaces can expose the boundary/revision more directly when operator inspection needs more than run artifacts. | `data/tasks/done/task-run-progress-and-scope-reflection-only-at-semantic.md`; `data/tasks/done/task-add-scope-progress-reviewer-automation.md`; `data/tasks/done/task-add-durable-event-envelope-and-journal.md`. |
| Telegram blocked or archived source handling | Telegram and other adapters can emit normalized inbound signals and owner/approval messages through module events. The inbound-signals module owns declarative route validation, source status, blocked/archived audit-only behavior, workflow target dispatch, and route/status inspection. | Telegram now covers text, media captions, transcribed voice/audio, edited messages, reactions, generic callbacks, and membership/status updates. True presence and message deletion signals remain unavailable to bots, and scenario-specific adapters remain open. | `data/tasks/done/task-add-declarative-inbound-signal-routing-for-channel.md`; `data/tasks/done/task-expand-telegram-signals-beyond-text-messages.md`. |
| Telegram sports availability with schedule matching | Inbound signals, generic event batches, setup/auth requirements, owner questions, owner decisions, and provider tools are composable workflow pieces. | A reference workflow still needs routing rules, calendar availability lookup, and provider-specific booking/reply/reaction actions. | `data/tasks/backlog/task-add-channel-opportunity-matching-reference-workflo.md`; `data/tasks/done/task-add-persisted-owner-confirmed-action-protocol.md`. |
| Confirmation-to-booking flow | Owner questions, approvals, owner decisions, confirmed action steps, and generic idempotency/dedupe can persist choices, gate dangerous effects, and reject duplicate consumption. Setup/auth requirements separate credential collection from agent context. | Provider-specific confirmed action adapters/reference workflows still need to land. | `data/tasks/done/task-add-persisted-owner-confirmed-action-protocol.md`; `data/tasks/done/task-add-generic-idempotency-and-dedupe-protocol.md`; `data/tasks/backlog/task-add-channel-opportunity-matching-reference-workflo.md`. |
| High-volume event batching with staged model passes | Workflow trigger batching supports scoped buffers, grouping, count/time/idle flushes, batch payloads, durable event ids for replay/dry-run inspection, dead-letter handling for poisoned events, module capability/effect manifests, and a compiled automation explain API for schemas, filters, batches, setup/auth blockers, policy gates, effects, downstream links, and sample-event outcomes. | Richer client inspection and broader simulation are still needed. | `data/tasks/done/task-add-generic-event-batching-to-workflow-triggers.md`; `data/tasks/done/task-add-event-schema-version-registry.md`; `data/tasks/done/task-add-durable-event-envelope-and-journal.md`; `data/tasks/done/task-add-dead-letter-queue-for-poisoned-events-and-batc.md`; `data/tasks/done/task-add-module-capability-and-effect-manifest.md`; `data/tasks/done/task-add-compiled-automation-graph-explain-api.md`. |
| Progress review from task or message intent | Progress reviewer accepts explicit owner/system requests and automatic revisioned strategic boundaries. Generic workflow batching and journal replay remain infrastructure for high-volume domain workflows, but completion counts and elapsed time are deliberately not progress-review signals. | A message-driven product workflow must translate relevant owner intent into the explicit typed request rather than using raw message volume as a proxy. | `data/tasks/done/task-run-progress-and-scope-reflection-only-at-semantic.md`; `data/tasks/done/task-add-scope-progress-reviewer-automation.md`; `data/tasks/done/task-add-durable-event-envelope-and-journal.md`. |

Known current gaps that affect the scenarios are: project terminology remains
as compatibility language on some routes and client code; durable event replay,
generic idempotency/dedupe, DLQ handling, module capability/effect manifests,
declarative inbound routing, and the shared UI contribution protocol now
exist, while retention policy consumers and scenario-specific adapters still
need their follow-up slices; Telegram cannot receive true online presence or
message deletion signals through the Bot API; some less central credentials
still flow through env/config before every module has setup declarations; bare
`kota` and `kota navigate` open the shared UI CLI client, `kota daemon` hosts
and monitors the daemon with control-path hints, and `kota ui` renders and
executes the shared surface graph through the same client contract.

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
