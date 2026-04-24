# Autonomy Module

This module owns the project autonomous development loop.

- Keep the autonomous workflows and their helpers inside this module; do
  not recreate a parallel workflow catalog in core.
- Durable autonomous learning belongs in scoped `AGENTS.md` at the
  narrowest useful directory. Evidence lives in run artifacts and git
  history; no second lessons store or injected summaries.
- Promote a lesson only when repeated run evidence shows a durable pattern;
  retract or narrow when code, behavior, or ownership changes.
- Workflow-specific prompts stay role-focused. Shared policy and operating
  conventions belong in this module's `AGENTS.md` hierarchy.
- Shipped autonomy workflows declare their harness in code so the repo
  boots cleanly without an operator `.kota/config.json`. Generic project
  workflows may still inherit `KotaConfig.defaultAgentHarness`.
- Judges inside a repair loop inherit the parent step's resolved harness, not
  a parallel fallback.

## Core Autonomy Decisions

Load-bearing rules from harness, eval, and peer-runtime research. Post
summaries live in run artifacts or `data/watchlist.yaml`.

- **Generator / evaluator separation.** Decomposer → builder → critic is
  planner/generator/evaluator. Strip repair-loop checks first; keep roles.
- **Evaluator probes outcomes, not just artifacts.** Diff-only review is
  blind to runtime behavior. Such tasks reduce success to an inspectable
  artifact or carry a runtime probe (see `workflows/builder/AGENTS.md`).
- **Critic input stays artifact-only.** Diff + repo state + run artifacts
  (+ optional runtime probe). No thinking traces or self-reports — CoT
  monitorability is fragile and self-reports reward-hack.
- **Infrastructure noise is not statistical noise.** Eval harnesses split
  allocation from kill thresholds, report resource profile, run fixtures
  multiple times, distinguish `pass@k` from `pass^k`. Judge-repetition
  per fixture belongs here too.
- **Context resets beat compaction.** Prefer fresh-session handoffs via
  run artifacts over in-session compaction for distinct-phase workflows.
- **Untrusted content is an injection surface.** Tool-risk gating
  classifies the call, not the payload. `injection-defense` screens the
  payload.
- **Session state reconstructible from append-only logs.** Daemon-owned
  runtime state answers "what survives a crash mid-turn"; write through
  to run artifacts or the event bus.
- **Eval fixtures come from real failures.** Seed `eval-harness` from
  `.kota/runs/`, not synthetic.

## Live-Run Evaluator Calibration

Fixture `pass^k` catches generator drift; per-run calibration artifacts
catch evaluator drift. Contradiction needs a later overlapping run that
also fails — file-overlap alone flags healthy refactor chains. Pass-with-
warnings uses looser overlap (critic already hedged). Monitor/notify
split mirrors the eval-harness regression pattern.

## External Pattern Decisions

Verdicts on peer patterns vs KOTA's `workflow` + `agent` + `module` +
bus-event + store model. Revisit only if a peer ships a primitive our
protocols cannot express.

- **Workflow DSLs (crewAI Flows, LangGraph Pregel).** Reject. Definition-
  driven routing + run artifacts + recovery cover durability.
- **Vercel AI SDK split.** Adopted — `daemon` + `client`.
- **Typed multi-agent handoffs (OpenHands, AutoGen).** Adopted via bus
  events and `trigger` steps.
- **Labeled memory blocks (Letta) / runtime skill stores (Hermes).**
  Reject. Typed stores cover labeled persistence; self-promoted runtime
  skills are the forbidden second lessons store.
- **Verbal self-reflection / strategy banks (Reflexion, ReasoningBank).**
  Reject. Improver + scoped `AGENTS.md` is learn-from-failure.
- **Routines / scheduled agents.** Already the `workflow` trigger.
- **Multi-agent coordination patterns.** generator-verifier, orchestrator-
  subagent, teams, bus, shared state map onto builder/critic, `delegate`
  + `composition`, dispatcher, bus, `composition.workspace` + stores.
- **Parallel-agent desktop UIs.** Client-surface pattern; new clients use
  the daemon control API. No second runtime host.
- **Managed Agents / brain-hands decoupling.** Reject. Daemon + session
  + workflow + run-artifact already decouples brain/hands; credentials-
  never-in-sandbox is `guardrails.ts` + `injection-defense`.
- **Claude Code auto mode + sandboxing.** Read. Autonomy mode +
  `approval-queue` + `injection-defense` + tool-risk guardrails realize
  the input-probe/output-classifier split.
- **Harness design for long-running apps.** Read — reinforces decomposer
  + builder + critic + `success-criteria*.txt` as planner/generator/
  evaluator + reset-over-compact + pre-code sprint contracts.
- **Multi-Claude parallel builds.** Reject. Parallel-builder teams with
  git-locks would be a second coordination surface; autonomy runs one-
  task-WIP through builder/critic.
- **Claude Code 1M context + session management.** Reject at workflow
  layer. Rewind/compact/clear is an interactive-session primitive; fresh-
  session-per-step + run-artifact handoff already realizes reset-over-
  compact.
- **Production MCP agent integration.** Read; reinforces `mcp-server`'s
  stance that MCP is a transport over KOTA capabilities, not a second
  registry.
- **AGI capability scoring / behavioral-disposition alignment.** Reject.
  `eval-harness` scores task outcomes; threat models do not apply to a
  first-party operator daemon.
- **Microsoft Agent Framework (AutoGen successor).** Reject. Graph-DSL +
  checkpoint falls under the rejected workflow-DSL slot; orchestration
  patterns map onto bus events + `trigger` steps; Python+.NET parity is
  the `daemon` + `client` split.

## Prompt Hierarchy And Harness Posture

- **Instruction hierarchy is KOTA's prompt model.** SDK system + core
  rails ≈ Root/System; autonomy mode + module prompt state ≈ Developer;
  channel/session user message ≈ User; tool/web outputs ≈ untrusted (via
  `injection-defense`). User/tool output must not silently escalate
  autonomy mode.
- **Trustworthy-agents four-layer injection defense maps onto existing
  surfaces.** Model/harness ≈ SDK boundary; tools ≈
  `src/core/tools/guardrails.ts` + risk; runtime ≈ `approval-queue` +
  autonomy mode + `injection-defense`. Plan-Mode "authorize strategies"
  if needed is a new autonomy mode, not a parallel approval surface.
- **Opus 4.7 harness defaults at the agent-step layer.** Delegate-don't-
  pair (front-load intent, constraints, success criteria in one turn),
  `xhigh` default, adaptive thinking, batch-upfront prompting, judicious
  subagent spawning (explicit builder→critic steps, not auto fan-out).
  Task contract + success-criteria files enforce this; steps must not
  reintroduce clarification loops or fixed reasoning caps.
- **Tool-design hygiene.** High bar for new tools; prefer discoverable
  surfaces (read, grep, scoped `AGENTS.md`, prompt state).
- **No `ask_owner` from autonomous workflow steps.** Every recorded
  autonomous call expires unanswered (`.kota/owner-questions/*.json`)
  after ~10 min of wasted wall-clock. For constraint conflicts, external
  blockers, or scope ambiguity, reshape the queue: move the task to
  `blocked/` with a `## Blocker` section, seed the enabler in `ready/`,
  commit. Re-enable only after a notification-delivery channel lands.

## Scoped Contracts

- `src/modules/injection-defense/AGENTS.md` — content-ingest screening.
- `src/modules/autonomy/workflows/builder/AGENTS.md` — critic runtime-probe
  protocol for non-artifact outcomes.

## Agent Judge Runtime Contract

The shared agent-step retry classifier (see
`src/core/workflow/steps/AGENTS.md`) governs autonomy judges. Judge-
backed repair checks (critic, improver semantic gate) catch runaway
turn/token throws in their wrapper and return a warning — editing code
cannot shrink a judge's budget — while the primitive still throws.
Unclassified SDK failures reject the check.
