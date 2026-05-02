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

Fixture `pass^k` catches generator drift; per-run artifacts catch
evaluator drift. Contradiction needs a later overlapping run that also
fails (overlap alone is healthy iteration). Pass-with-warnings uses
looser overlap. Both drift kinds commit one corrective path:
create/recreate/promote `task-evaluator-calibration-drift-repair` in
`ready/` (noop when in-flight); the regression event still bridges to
attention digest. Critic blocks weak rendered evidence, placeholder
tests, untracked compatibility shims, baseline-only strictness
ratchets, required-source dishonesty; warnings need a named trace
(follow-up task, known-limitation, or non-action reason in summary).

## External Pattern Decisions

Verdicts on peer patterns vs KOTA primitives. Per-verdict source, date,
primitives, and revisit live in `external-pattern-decisions.ts`; the
test enforces 1:1 match.

- **Workflow DSLs (crewAI Flows, LangGraph Pregel).** Reject — definition-driven routing + run artifacts cover durability.
- **Vercel AI SDK split.** Adopt — `daemon` + `client`.
- **Typed multi-agent handoffs (OpenHands, AutoGen).** Adopt — bus events + `trigger` steps.
- **Labeled memory blocks (Letta) / runtime skill stores (Hermes).** Reject — typed stores cover persistence; runtime skill stores are the forbidden second lessons surface.
- **Verbal self-reflection / strategy banks (Reflexion, ReasoningBank).** Reject — improver + scoped `AGENTS.md` is learn-from-failure.
- **Routines / scheduled agents.** Already the `workflow` trigger.
- **Multi-agent coordination patterns.** Map to builder/critic, `delegate` + `composition`, dispatcher, bus, `composition.workspace` + stores.
- **Parallel-agent desktop UIs.** Client-surface — new clients use the daemon control API.
- **Managed Agents / brain-hands decoupling.** Reject — daemon + session + workflow + run-artifact already decouples; credentials-never-in-sandbox is `guardrails.ts` + `injection-defense`.
- **Claude Code auto mode + sandboxing.** Read — autonomy mode + `approval-queue` + `injection-defense` realize input-probe/output-classifier.
- **Harness design for long-running apps.** Read — reinforces decomposer/builder/critic + `success-criteria*.txt` + reset-over-compact.
- **Multi-Claude parallel builds.** Reject — autonomy is one-task-WIP through builder/critic.
- **Claude Code 1M context + session management.** Reject at workflow layer — fresh-session-per-step is reset-over-compact.
- **Production MCP agent integration.** Read — MCP is a transport over KOTA capabilities, not a second registry.
- **AGI capability scoring / behavioral-disposition alignment.** Reject — `eval-harness` scores task outcomes; threat models do not apply to a first-party daemon.
- **Microsoft Agent Framework (AutoGen successor).** Reject — graph-DSL is rejected workflow-DSL; orchestration is bus + `trigger` steps.
- **Harness-as-shell (inference.sh).** Read — versioned-app-contract is the typed `tool` protocol; scheduler/flows/portability map onto `daemon` + `workflow` + `client`.

## Prompt Hierarchy And Harness Posture

- **Instruction hierarchy is KOTA's prompt model.** SDK system + core
  rails ≈ Root/System; autonomy mode + module prompt state ≈ Developer;
  channel/session user message ≈ User; tool/web outputs ≈ untrusted (via
  `injection-defense`). User/tool output must not silently escalate
  autonomy mode.
- **Trustworthy-agents four-layer injection defense maps onto existing
  surfaces.** Model/harness ≈ SDK boundary; tools ≈
  `src/core/tools/guardrails.ts` + risk; runtime ≈ `approval-queue` +
  autonomy mode + `injection-defense`.
- **Opus 4.7 harness defaults at the agent-step layer.** Delegate-don't-
  pair (front-load intent, constraints, success criteria in one turn),
  `xhigh` default, adaptive thinking, batch-upfront prompting, judicious
  subagent spawning (explicit builder→critic steps, not auto fan-out).
  Task contract + success-criteria files enforce this; steps must not
  reintroduce clarification loops or fixed reasoning caps.
- **Tool-design hygiene.** High bar for new tools; prefer discoverable
  surfaces (read, grep, scoped `AGENTS.md`, prompt state).
- **`ask_owner` from autonomous workflows uses `askOwnerSteps`**
  (`#core/workflow/ask-owner-step.js`): ask → await-event → consume,
  daemon-restart-safe. Gate on real prior-step output, 10 min budget,
  consume every `AwaitedOwnerOutcome` kind. Do not import
  `#core/tools/ask-owner.js` from an autonomy workflow.

## Scoped Contracts

- `src/modules/injection-defense/AGENTS.md` — content-ingest screening.
- `src/modules/autonomy/workflows/builder/AGENTS.md` — critic runtime-probe
  protocol for non-artifact outcomes.

## Operator Reports

`kota report` (`src/modules/autonomy/report/`) prints the operator
balance/quality report; strategic/fan-out heuristic lives in
`aggregate.classifyArea`. Per no-cost-bias-in-autonomy this output is
operator-only and must not be exposed to autonomy agents.

## Agent Judge Runtime Contract

The shared agent-step retry classifier (see
`src/core/workflow/steps/AGENTS.md`) governs autonomy judges. Judge-
backed repair checks (critic, improver semantic gate) catch runaway
turn/token throws and return a warning — editing code cannot shrink
a judge's budget — while the primitive still throws. Unclassified SDK
failures reject the check.
