# Autonomy Module

This module owns the project autonomous development loop.

- Keep the autonomous workflows inside this module.
- Shared helpers used only by these workflows belong here too.
- Do not recreate a parallel workflow catalog in core just to surface these workflows.
- Durable autonomous learning belongs in scoped `AGENTS.md` guidance at the
  narrowest useful directory. Evidence belongs in run artifacts and git history;
  do not create a second lessons store or inject stale summaries into prompts.
- Promote a lesson only when repeated run evidence shows a durable pattern.
  Retract or narrow guidance when code, behavior, or ownership changes.
- Workflow-specific prompts should stay role-focused. Shared policy and
  operating conventions belong in this module's `AGENTS.md` hierarchy.
- Shipped autonomy workflows declare their harness explicitly in code so this
  repo boots cleanly without an operator-local `.kota/config.json`. Generic
  project workflows may still inherit `KotaConfig.defaultAgentHarness`.
- Judges inside a repair loop inherit the parent step's resolved harness rather
  than loading a parallel fallback.

## Core Autonomy Decisions

Load-bearing rules from harness, eval, and peer-runtime research. Post
summaries live in run artifacts or `data/watchlist.yaml`; only KOTA
decisions belong here.

- **Generator / evaluator separation.** Decomposer → builder → critic is
  planner/generator/evaluator. Strip repair-loop checks first; keep the
  role separation.
- **Evaluator probes outcomes, not only artifacts.** Diff-only review is
  blind to runtime service behavior, UI, external API. Such tasks reduce
  success to an inspectable artifact or carry a runtime probe (see
  `workflows/builder/AGENTS.md`).
- **Critic input stays artifact-only.** Diff + repo state + run artifacts
  (+ optional runtime probe). No raw thinking traces, interpretability
  artifacts, or self-reported summaries — CoT monitorability is fragile
  and self-reports reward-hack.
- **Infrastructure noise is not statistical noise.** Eval harnesses
  separate guaranteed allocation from kill thresholds, report resource
  profile per run, run each fixture multiple times, and distinguish
  `pass@k` from `pass^k`. Judge-repetition per fixture belongs here too.
- **Context resets beat compaction.** Prefer fresh-session handoffs
  through run artifacts over in-session compaction for workflows with
  distinct phases.
- **Untrusted content is an injection surface.** Tool-risk gating
  classifies the call, not the payload. `injection-defense` screens
  payloads — see its `AGENTS.md`.
- **Session state reconstructible from append-only logs.** New daemon-
  owned runtime state answers "what survives a crash mid-turn"; write
  through to run artifacts or the event bus.
- **Eval fixtures come from real failures.** Seed `eval-harness` from
  `.kota/runs/` failures, not synthetic specs.

## Live-Run Evaluator Calibration

Fixture `pass^k` catches generator drift; per-run evaluator calibration
artifacts catch evaluator drift. Contradiction needs a later overlapping
run that itself carries a failure signal — file-overlap alone would flag
healthy refactor chains. Pass-with-warnings stays on looser overlap
because the critic already hedged. Monitor and notify split, mirroring
the eval-harness regression notify pattern.

## External Pattern Decisions

Verdicts on peer patterns relative to KOTA's `workflow` + `agent` +
`module` + bus-event + store model. Revisit only if a peer ships a
primitive existing protocols cannot express.

- **Workflow DSLs (crewAI Flows, LangGraph Pregel).** Reject. Definition-
  driven routing + run artifacts + recovery triggers + repair loop cover
  durability.
- **Vercel AI SDK server/client split.** Adopted — `daemon` + `client`.
- **Typed multi-agent handoffs (OpenHands, AutoGen).** Adopted via typed
  bus events and `trigger` steps.
- **Labeled memory blocks (Letta) / runtime skill stores (Hermes).**
  Reject. Typed stores with provider backends cover labeled persistence;
  runtime self-promoted skills are the forbidden second lessons store.
- **Verbal self-reflection / strategy banks (Reflexion, ReasoningBank).**
  Reject. Improver workflow + scoped `AGENTS.md` is the learn-from-
  failure primitive. A second lessons store is forbidden.
- **Routines / scheduled agents.** Already the `workflow` trigger
  protocol; no second automation surface.
- **Multi-agent coordination patterns.** generator-verifier, orchestrator-
  subagent, agent teams, message bus, shared state all map onto existing
  primitives (builder/critic, `delegate` + `composition`, dispatcher fan-
  out, event bus, `composition.workspace` + stores).
- **Parallel-agent desktop UIs.** Client-surface pattern; new clients
  consume the daemon control API. No second runtime session host.
- **Claude Managed Agents platform posture.** Reject. KOTA is local-first,
  operator-controlled; outcome-iteration is already builder + critic +
  repair loop.
- **Advisor / executor-escalates.** Park. Would add a second cost-
  sensitive routing surface under `agent-harness`; revisit only inside a
  harness adapter if a concrete workflow benefits.
- **AGI capability-level scoring (Levels of AGI).** Reject as an eval
  primitive. `eval-harness` scores task outcomes, not capability classes.
- **Harmful-manipulation toolkit / behavioral-disposition alignment.**
  Reject. Threat models do not apply to a first-party operator daemon;
  critic anchors on artifacts, not self-reports.

## Prompt Hierarchy And Harness Posture

- **Instruction hierarchy is KOTA's prompt model.** SDK system + core
  safety rails ≈ Root/System; operator-set autonomy mode + module prompt
  state ≈ Developer; channel/session user message ≈ User; tool/web
  outputs ≈ untrusted (enforced by `injection-defense`). A user message
  or tool output must not silently escalate the operator-set autonomy
  mode.
- **Trustworthy-agents four-layer injection defense maps onto existing
  surfaces.** Model/harness ≈ SDK harness boundary; tools ≈
  `src/core/tools/guardrails.ts` + risk classification; runtime ≈
  `approval-queue` + autonomy mode + `injection-defense` middleware. Do
  not import Plan-Mode "authorize strategies, not actions" wholesale; if
  ever needed it belongs as a new autonomy mode, not a parallel approval
  surface.
- **Opus 4.7 harness defaults at the agent-step layer.** Delegate-don't-
  pair (front-load intent, constraints, success criteria in one turn),
  `xhigh` as default effort (not `max`), adaptive thinking rather than
  fixed reasoning budgets, batch-upfront prompting. The task contract +
  success-criteria files enforce this shape; keep agent steps from
  reintroducing per-turn clarification loops or fixed reasoning caps.
- **Tool-design hygiene.** High bar for new tools; prefer discoverable
  surfaces (file read, grep, scoped `AGENTS.md`, module prompt state)
  over a new tool. Reinforces `src/AGENTS.md` "prefer clear discoverable
  surfaces over injected context summaries."

## Scoped Contracts

Module-specific mechanisms live in the owning directory's `AGENTS.md`:

- `src/modules/injection-defense/AGENTS.md` — content-ingest screening
  middleware contract.
- `src/modules/autonomy/workflows/builder/AGENTS.md` — critic runtime-probe
  protocol for non-artifact outcomes.

## Agent Judge Runtime Contract

The shared agent-step retry classifier (see `src/core/workflow/steps/AGENTS.md`)
also governs autonomy agent judges, so judges fail fast on runaway turn or
token subtypes instead of burning budget.

Judge-backed repair checks (critic, improver semantic gate) must
additionally catch the runaway throw in their wrapper and return a warning
— never re-raise into the repair loop, since editing code cannot shrink a
judge's turn or token budget. Only the repair-check wrappers degrade
gracefully; the judge invocation primitive itself still throws.
Unclassified SDK failures still reject the check.
