# Autonomy Module

This module owns the project autonomous development loop.

- Keep the autonomous workflows and their helpers inside this module; do
  not recreate a parallel workflow catalog in core.
- Durable autonomous learning belongs in scoped `AGENTS.md` at the narrowest
  useful directory. Evidence belongs in run artifacts and git history; do not
  create a second lessons store or inject stale summaries into prompts.
- Promote a lesson only when repeated run evidence shows a durable pattern;
  retract or narrow when code, behavior, or ownership changes.
- Workflow-specific prompts stay role-focused. Shared policy and operating
  conventions belong in this module's `AGENTS.md` hierarchy.
- Shipped autonomy workflows declare their harness explicitly in code so this
  repo boots cleanly without an operator-local `.kota/config.json`. Generic
  project workflows may still inherit `KotaConfig.defaultAgentHarness`.
- Judges inside a repair loop inherit the parent step's resolved harness, not
  a parallel fallback.

## Core Autonomy Decisions

Load-bearing rules from harness, eval, and peer-runtime research. Post
summaries live in run artifacts or `data/watchlist.yaml`.

- **Generator / evaluator separation.** Decomposer → builder → critic is
  planner/generator/evaluator. Strip repair-loop checks first; keep the
  role separation.
- **Evaluator probes outcomes, not just artifacts.** Diff-only review is
  blind to runtime behavior. Such tasks reduce success to an inspectable
  artifact or carry a runtime probe (see `workflows/builder/AGENTS.md`).
- **Critic input stays artifact-only.** Diff + repo state + run artifacts
  (+ optional runtime probe). No thinking traces or self-reports — CoT
  monitorability is fragile and self-reports reward-hack.
- **Infrastructure noise is not statistical noise.** Eval harnesses split
  guaranteed allocation from kill thresholds, report resource profile per
  run, run each fixture multiple times, and distinguish `pass@k` from
  `pass^k`. Judge-repetition per fixture belongs here too.
- **Context resets beat compaction.** Prefer fresh-session handoffs via
  run artifacts over in-session compaction for distinct-phase workflows.
- **Untrusted content is an injection surface.** Tool-risk gating
  classifies the call, not the payload. `injection-defense` screens the
  payload.
- **Session state reconstructible from append-only logs.** Daemon-owned
  runtime state answers "what survives a crash mid-turn"; write through
  to run artifacts or the event bus.
- **Eval fixtures come from real failures.** Seed `eval-harness` from
  `.kota/runs/`, not synthetic specs.

## Live-Run Evaluator Calibration

Fixture `pass^k` catches generator drift; per-run calibration artifacts
catch evaluator drift. Contradiction needs a later overlapping run that
itself fails — file-overlap alone flags healthy refactor chains. Pass-
with-warnings uses looser overlap because the critic already hedged.
Monitor/notify split mirrors the eval-harness regression pattern.

## External Pattern Decisions

Verdicts on peer patterns vs KOTA's `workflow` + `agent` + `module` +
bus-event + store model. Revisit only if a peer ships a primitive
existing protocols cannot express.

- **Workflow DSLs (crewAI Flows, LangGraph Pregel).** Reject. Definition-
  driven routing + run artifacts + recovery + repair loop cover durability.
- **Vercel AI SDK split.** Adopted — `daemon` + `client`.
- **Typed multi-agent handoffs (OpenHands, AutoGen).** Adopted via bus
  events and `trigger` steps.
- **Labeled memory blocks (Letta) / runtime skill stores (Hermes).**
  Reject. Typed stores cover labeled persistence; runtime self-promoted
  skills are the forbidden second lessons store.
- **Verbal self-reflection / strategy banks (Reflexion, ReasoningBank).**
  Reject. Improver workflow + scoped `AGENTS.md` is the learn-from-failure
  primitive.
- **Routines / scheduled agents.** Already the `workflow` trigger.
- **Multi-agent coordination patterns.** generator-verifier, orchestrator-
  subagent, teams, message bus, shared state all map onto existing
  primitives (builder/critic, `delegate` + `composition`, dispatcher, bus,
  `composition.workspace` + stores).
- **Parallel-agent desktop UIs.** Client-surface pattern; new clients use
  the daemon control API. No second runtime session host.
- **Managed Agents / brain-hands decoupling.** Reject the platform. The
  daemon + session + workflow + run-artifact split already implements
  brain/hands decoupling locally; credentials-never-in-sandbox is
  `guardrails.ts` + `injection-defense`.
- **Claude Code auto mode + sandboxing.** Read. Autonomy mode +
  `approval-queue` + `injection-defense` + tool-risk guardrails already
  realize the input-probe/output-classifier split.
- **Harness design for long-running apps.** Read, reinforces existing
  posture — planner/generator/evaluator, reset-over-compact, and pre-code
  sprint contracts are decomposer + builder + critic + `success-criteria*.txt`.
- **Multi-Claude parallel builds.** Reject. Parallel-builder teams with
  git-lock task claims and oracle partitioning would be a second
  coordination surface; autonomy runs one-task-WIP through builder/critic.
- **Claude Code 1M context + session management.** Reject at the workflow
  layer. Continue / rewind / `/compact` / `/clear` / subagent is an
  interactive-session primitive; KOTA's workflow + fresh-session-per-step
  + run-artifact handoff already realizes reset-over-compact.
- **Production MCP agent integration.** Read; reinforces tool-design
  hygiene and `mcp-server`'s stance that MCP is a transport over KOTA
  capabilities, not a second registry.
- **AGI capability scoring / behavioral-disposition alignment.** Reject.
  `eval-harness` scores task outcomes, not capability classes; threat
  models do not apply to a first-party operator daemon.

## Prompt Hierarchy And Harness Posture

- **Instruction hierarchy is KOTA's prompt model.** SDK system + core
  rails ≈ Root/System; operator-set autonomy mode + module prompt state ≈
  Developer; channel/session user message ≈ User; tool/web outputs ≈
  untrusted (enforced by `injection-defense`). A user message or tool
  output must not silently escalate the autonomy mode.
- **Trustworthy-agents four-layer injection defense maps onto existing
  surfaces.** Model/harness ≈ SDK boundary; tools ≈
  `src/core/tools/guardrails.ts` + risk classification; runtime ≈
  `approval-queue` + autonomy mode + `injection-defense` middleware. Do
  not import Plan-Mode "authorize strategies, not actions" wholesale; if
  needed it is a new autonomy mode, not a parallel approval surface.
- **Opus 4.7 harness defaults at the agent-step layer.** Delegate-don't-
  pair (front-load intent, constraints, success criteria in one turn),
  `xhigh` default effort, adaptive thinking over fixed reasoning budgets,
  batch-upfront prompting, and judicious subagent spawning (explicit
  builder→critic workflow steps, not auto fan-out — 4.7 delegates less by
  default). Task contract + success-criteria files enforce this; agent
  steps must not reintroduce clarification loops or fixed reasoning caps.
- **Tool-design hygiene.** High bar for new tools; prefer discoverable
  surfaces (read, grep, scoped `AGENTS.md`, module prompt state).

## Scoped Contracts

- `src/modules/injection-defense/AGENTS.md` — content-ingest screening.
- `src/modules/autonomy/workflows/builder/AGENTS.md` — critic runtime-probe
  protocol for non-artifact outcomes.

## Agent Judge Runtime Contract

The shared agent-step retry classifier (see
`src/core/workflow/steps/AGENTS.md`) governs autonomy judges, so they
fail fast on runaway turn/token subtypes. Judge-backed repair checks
(critic, improver semantic gate) catch the runaway throw in their
wrapper and return a warning — editing code cannot shrink a judge's
budget — while the judge primitive still throws. Unclassified SDK
failures still reject the check.
