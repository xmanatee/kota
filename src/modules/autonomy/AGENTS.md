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

## Harness And Eval Decisions

Decision-level takeaways from Anthropic's harness-design, infrastructure-noise,
auto-mode, managed-agents, and demystifying-evals posts. Post summaries live in
run artifacts; only KOTA decisions belong here.

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

Fixture `pass^k` catches generator drift; per-run evaluator calibration
artifacts catch evaluator drift. Contradiction needs a later overlapping
run that itself carries a failure signal — file-overlap alone would flag
healthy refactor chains and train autonomy away from correct iteration.
Pass-with-warnings stays on looser overlap because the critic already
hedged. Monitor and notify split, mirroring the eval-harness regression
notify pattern.

## Peer Runtime Pattern Decisions

Verdicts on externally visible peer runtime patterns (coordination, memory,
self-reflection) relative to KOTA's `workflow` + `agent` + `module` +
bus-event + store model.

- **crewAI Flows / LangGraph Pregel (workflow DSLs).** Reject. A DSL on
  workflows creates a second public automation surface and conflicts with
  definition-driven routing. Durability is met by `.kota/runs/` artifacts,
  recovery triggers, repair-loop retry, and per-item retry on fan-out.
- **Vercel AI SDK server/client split.** Adopted. `session` is the tool
  loop; `daemon` + `client` protocols enforce thin clients.
- **OpenHands / AutoGen typed multi-agent handoffs.** Adopted. Handoffs
  travel over typed bus events (decomposer → builder → critic, dispatcher
  fan-out on idle) and `trigger` steps; payload typing via workflow I/O
  schemas.
- **Letta labeled memory blocks (`letta-ai/letta`).** Reject. KOTA's typed
  stores with provider-registry backends already cover labeled,
  agent-selectable persistence.
- **Reflexion verbal self-reflection (`noahshinn/reflexion`).** Reject.
  Improver workflow + scoped `AGENTS.md` is KOTA's "learn from failure"
  primitive; a Reflexion lesson log is the forbidden second lessons store.
- **Hermes Agent (`nousresearch/hermes-agent`).** Reject its runtime
  self-promoted skills, community skill marketplace, and FTS5 +
  LLM-summarized session search as new primitives. Reusable guidance must
  flow through the `module` protocol (dependency declaration, load/unload
  safety, trust/secrets scope); a runtime skill store duplicates the
  Reflexion "second lessons store" already rejected. Long-horizon retrieval
  belongs inside `history`/`memory` providers — index engine (SQLite FTS5,
  pgvector, etc.) is a provider detail. MCP and external-service tools are
  just `tool`; cron-style scheduling fits the `workflow` trigger protocol;
  parallel subagent delegation is the OpenHands/AutoGen entry above.

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
  Selective lower-tier override on conflict (arXiv 2404.13208) maps onto
  the SDK/module prompt-state vs. channel/user-message split, with
  `injection-defense` wrapping ingested tool/web content as untrusted.
  Reject any pattern that lets module prompt state echo tool/web payloads
  as authoritative, or lets a channel/user message sit above the
  operator-set autonomy mode.
- **Critic input stays artifact-only because CoT monitorability is fragile.**
  Reasoning-trace oversight (arXiv 2507.11473) is easily-degraded and
  liable to vanish silently under downstream training or harness choices.
  Keep critic and improver judges anchored on diff + repo state + run
  artifacts (+ optional runtime probe per `workflows/builder/AGENTS.md`),
  not raw thinking traces. Do not add a "judge from thinking" optimization.
- **Model Spec chain-of-command maps onto KOTA roles.** Spec ranks
  Root > System > Developer > User > Guideline, with tool outputs and
  quoted content carrying no authority by default. KOTA mapping: SDK
  system prompt + core safety rails ≈ Root/System; operator-set autonomy
  mode + module prompt state ≈ Developer; channel/session user message ≈
  User; tool/web outputs ≈ untrusted (enforced by `injection-defense`).
  Make the mapping explicit at the autonomy-mode boundary so a user
  message or tool output cannot silently escalate the operator-set mode.

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
