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

## Harness And Eval Decisions (Anthropic Engineering Takeaways)

Decision-level takeaways from Anthropic's Mar 2026 harness-design,
infrastructure-noise, Claude-Code-auto-mode, managed-agents, and
demystifying-evals posts. Post summaries live in run artifacts; only KOTA
decisions belong here.

- **Generator / evaluator separation is the right shape.** Decomposer →
  builder → critic mirrors planner/generator/evaluator. Do not collapse as
  models improve. Strip repair-loop checks or semantic gates first; keep
  the agent-role separation.
- **Evaluator must probe outcomes, not only artifacts.** Diff-only review
  is structurally blind for outcomes living outside repo state (runtime
  service behavior, UI, external API). New tasks whose success hinges on
  runtime behavior must reduce success to an inspectable artifact or carry
  a runtime probe as part of the task contract.
- **Infrastructure noise is not statistical noise.** Any KOTA eval harness
  must separate guaranteed allocation from kill thresholds, report resource
  profile per run, run each fixture multiple times, and distinguish `pass@k`
  (capability) from `pass^k` (consistency).
- **Context resets beat compaction for long autonomy loops.** Prefer
  fresh-session handoffs through run artifacts over in-session compaction
  when a workflow has distinct phases. The run-dir handoff pattern is
  correct; keep it.
- **Untrusted content entering agent context is an injection surface.**
  Tool-risk gating classifies the *call*, not the *payload*. The
  `injection-defense` module screens payloads — see its `AGENTS.md` for
  the contract; extend when coverage or heuristics need to grow.
- **Session state must be reconstructible from append-only logs.** New
  daemon-owned runtime state needs an answer for "what survives a crash
  mid-turn"; write through to run artifacts or the event bus rather than
  holding state only in process memory.
- **Eval fixtures come from real failures, not synthetic specs.** Seed the
  eval-harness module from `.kota/runs/` failures first.

## Live-Run Evaluator Calibration

Fixture `pass^k` catches generator drift; `evaluator-calibration.json`
(per builder run, from existing artifacts) catches evaluator drift.
Contradiction needs a later overlapping run that itself carries a failure
signal — file-overlap alone would flag healthy refactor chains and train
autonomy away from correct iteration. Pass-with-warnings stays on looser
overlap because the critic already hedged. Monitor+notify split mirrors
`eval-harness-regression-notify`. Import: `eval-harness` → `autonomy`.

## Peer Runtime Pattern Decisions

Verdicts on externally visible peer runtime patterns (coordination, memory,
self-reflection) relative to KOTA's `workflow` + `agent` + `module` +
bus-event + store model.

- **crewAI Flows (`@router` / `or_` / `and_`).** Reject. A DSL on workflows
  creates a second public automation surface and conflicts with
  definition-driven routing (`workflows/AGENTS.md`) and "typed protocols
  over parallel DSLs". `trigger`, `parallel`, `branch`, `foreach` already
  cover the coordination kinds.
- **LangGraph Pregel graph.** Reject the DSL; durability is met by
  `.kota/runs/` artifacts, `runtime.recovered` + `recoveryCapable`,
  `repairLoop` retry, and `foreach.retryFailedItems`. A graph primitive
  would reintroduce the workflow-name-inventory anti-pattern.
- **Vercel AI SDK server/client split.** Adopted. `session` is the tool
  loop; `daemon` + `client` protocols enforce thin clients.
- **OpenHands / AutoGen typed multi-agent handoffs.** Adopted. Handoffs
  travel over typed bus events (decomposer → builder → critic, dispatcher
  fan-out on `runtime.idle`) and `trigger` steps; payload typing via
  workflow `inputSchema` / `outputSchema`.
- **Letta labeled `memory_blocks`.** Reject. KOTA's typed stores (history,
  memory, knowledge, working memory, run artifacts) with provider-registry
  backends already cover labeled, agent-selectable persistence. Evidence:
  `letta-ai/letta`.
- **Reflexion verbal self-reflection.** Reject. Improver workflow + scoped
  `AGENTS.md` guidance is KOTA's "learn from failure" primitive; a Reflexion
  lesson log is the forbidden second lessons store (see file top). Evidence:
  `noahshinn/reflexion`.

Revisit if a peer ships a primitive whose rationale is not captured by
KOTA's existing protocols.

Scoped contracts for module-specific mechanisms live in the owning
directory's `AGENTS.md`:

- `src/modules/injection-defense/AGENTS.md` — content-ingest screening
  middleware contract.
- `src/modules/autonomy/workflows/builder/AGENTS.md` — critic runtime-probe
  protocol for non-artifact outcomes.

## OpenAI Research Distillation

Decision-level takeaways from the autonomy-eval-adjacent OpenAI threads on
`data/watchlist.yaml`. Snapshot summaries belong there; only KOTA decisions
belong here.

- **Instruction hierarchy is already KOTA's prompt model — keep it.**
  arXiv 2404.13208 trains selective lower-tier override on conflict. KOTA
  already separates SDK/module prompt state from channel/user messages, and
  `injection-defense` wraps ingested tool/web content as untrusted. Reject
  any pattern that lets module prompt state echo tool/web payloads as
  authoritative, or lets a channel/user message sit above the operator-set
  autonomy mode.
- **Critic input stays artifact-only because CoT monitorability is fragile.**
  arXiv 2507.11473 treats reasoning-trace oversight as easily-degraded and
  liable to vanish silently under downstream training or harness choices.
  Keep critic and improver judges anchored on diff + repo state + run
  artifacts (+ optional runtime probe per `workflows/builder/AGENTS.md`),
  not raw thinking traces. Do not add a "judge from thinking" optimization.
- **Model Spec chain-of-command maps onto KOTA roles.** Spec ranks
  Root > System > Developer > User > Guideline, with tool outputs and quoted
  content carrying no authority by default. KOTA mapping: SDK system prompt
  + core safety rails ≈ Root/System; operator-set autonomy mode + module
  prompt state ≈ Developer; channel/session user message ≈ User; tool/web
  outputs ≈ untrusted (enforced by `injection-defense`). Make the mapping
  explicit at the autonomy-mode boundary so a user message or tool output
  cannot silently escalate the operator-set mode.

## Agent Judge Runtime Contract

The shared agent-step retry classifier (see `src/core/workflow/steps/AGENTS.md`)
also governs autonomy agent judges invoked via `invokeAgentJudge`, so judges
fail fast on runaway subtypes (`error_max_turns`, `error_max_tokens`) instead
of burning budget.

Judge-backed repair checks (critic, improver semantic gate) must additionally
catch the runaway throw in their wrapper and return a warning — never re-raise
into the repair loop, since editing code cannot shrink a judge's turn/token
budget. Use `isJudgeRunawayError` + `judgeUnavailableResult` exported from
`critic.ts`. `invokeAgentJudge` itself still throws; only the repair-check
wrappers degrade gracefully. Unclassified SDK failures still reject the check.
