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
  models improve. When stripping scaffolding, strip repair-loop checks or
  semantic gates first; keep the agent-role separation.
- **Evaluator must probe outcomes, not only artifacts.** Diff-only review
  is structurally blind for outcomes living outside repo state (runtime
  service behavior, UI, external API). New tasks whose success hinges on
  runtime behavior must reduce success to an inspectable artifact or carry
  a runtime probe as part of the task contract.
- **Infrastructure noise is not statistical noise.** Any KOTA eval harness
  must separate guaranteed resource allocation from kill thresholds, report
  resource profile per run, run each fixture multiple times, and distinguish
  `pass@k` (capability) from `pass^k` (consistency).
- **Context resets beat compaction for long autonomy loops.** Prefer
  fresh-session handoffs through run artifacts over in-session compaction
  when a workflow has distinct phases. The run-dir handoff pattern is
  correct; keep it.
- **Untrusted content entering agent context is an injection surface.**
  Tool-risk gating classifies the *call*, not the *payload*. The
  `injection-defense` module screens payloads — see
  `src/modules/injection-defense/AGENTS.md` for the contract; extend it
  when coverage or heuristics need to grow.
- **Session state must be reconstructible from append-only logs.** Any new
  daemon-owned runtime state needs an answer for "what survives a daemon
  crash mid-turn"; default to writing through to run artifacts or the event
  bus rather than holding state only in process memory.
- **Eval fixtures come from real failures, not synthetic specs.** Seed the
  eval-harness module from `.kota/runs/` failures first.

## Live-Run Evaluator Calibration

Fixture `pass^k` catches generator drift; `evaluator-calibration.json`
(per builder run, derived from existing artifacts) catches evaluator
drift. Contradiction = later run within follow-up window touches
overlapping source files. Monitor+notify split mirrors
`eval-harness-regression-notify`. Import: `eval-harness` → `autonomy`.

## Peer Coordination Pattern Decisions

Peer runtimes (crewAI, LangGraph, Vercel AI SDK, OpenHands/AutoGen) expose
task-plus-process coordination primitives. None warrants adoption: KOTA's
`workflow` + `agent` + `module` + bus-event model already covers the
equivalent shape in typed code.

- **crewAI Flows (`@router` / `or_` / `and_`).** Reject. A DSL layered on
  workflows would create a second public automation surface beside `workflow`
  and conflicts with KOTA's definition-driven routing (see
  `workflows/AGENTS.md`) and the "typed protocols over parallel DSLs"
  direction. Sequential, hierarchical, and conditional coordination already
  exist as `trigger`, `parallel`, `branch`, and `foreach` step kinds.
- **LangGraph Pregel graph.** Reject the DSL; the durability property is
  already met by `.kota/runs/` artifacts, `runtime.recovered` +
  `recoveryCapable`, `repairLoop` retry, and `foreach.retryFailedItems`.
  A first-class graph primitive would reintroduce the workflow-name-inventory
  anti-pattern `workflows/AGENTS.md` forbids.
- **Vercel AI SDK server/client split.** Already adopted. `session` is a
  tool-loop agent; `daemon` + `client` protocols enforce thin clients.
- **OpenHands / AutoGen typed multi-agent handoffs.** Already adopted.
  Handoffs travel over typed bus events (decomposer → builder → critic,
  dispatcher fan-out on `runtime.idle`) and `trigger` steps; payload typing
  is tracked by workflow `inputSchema` / `outputSchema`.

Revisit if a peer runtime ships a primitive whose rationale cannot be
captured by KOTA's existing protocols.

Scoped contracts for module-specific mechanisms live in the owning
directory's `AGENTS.md`:

- `src/modules/injection-defense/AGENTS.md` — content-ingest screening
  middleware contract.
- `src/modules/autonomy/workflows/builder/AGENTS.md` — critic runtime-probe
  protocol for non-artifact outcomes.
