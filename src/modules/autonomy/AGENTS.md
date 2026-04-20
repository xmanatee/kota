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
  `injection-defense` module screens payloads (see below); extend it when
  coverage or heuristics need to grow.
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

## Injection Defense

The `injection-defense` module post-processes content-ingest tool output
(`web_fetch`, `web_search`, `http_request`, `read_document`) before it
reaches agent context. Contract:

- Autonomous runs opt in by default. Supervised and passive sessions are
  opt-in via `modules.injection-defense.targetModes`.
- Suspicious payloads are **annotated**, never dropped: the middleware
  prepends a banner naming the tool and reason tags, wraps the original
  content between stable "untrusted content" markers, and leaves the
  payload intact so legitimate information still gets through.
- Every screened call emits `injection.defense.assessed` — suspicious or
  not — so operators can audit both false positives and missed attacks.
- The defense is **additive**. Tool-risk gating and the approval queue
  still apply; a moderate tool does not become safer because its output
  was screened.
- New ingest channels should be added to `DEFAULT_TARGET_TOOLS` rather
  than wrapping their output elsewhere. Detection heuristics live in
  `detector.ts` and should stay cheap and structural; escalation to a
  classifier, if ever needed, extends the middleware rather than
  replacing it.

## Runtime Probes

The builder's critic inspects the diff, task state, and run artifacts.
When success lives in runtime behavior a diff cannot prove (HTTP route
payload, UI regression, event ordering, daemon runtime misbehavior),
a task can declare an optional runtime probe the critic runs before
judging.

- A probe is a typed shell command with a deterministic exit-code
  predicate: exit 0 passes, any other status fails. The probe is the
  task author's declared success predicate for behavior the diff alone
  cannot prove.
- Default to artifact-only success. Reshape the task to land a test
  assertion, a structured output artifact, or a repo-state change
  before reaching for a probe. Probes should be the exception.
- Add a probe only when success genuinely lives outside repo state and
  no honest artifact-only reshaping exists.
- A probe is declared inside the task body as a `## Runtime Probe`
  section. The section body is `key: value` lines, optionally wrapped
  in a fenced code block. Recognized keys: `command` (required) and
  `timeoutMs` (optional, defaults to 120000, capped at 30 minutes).
  Malformed declarations fail loudly — the critic does not silently
  skip a broken probe.
- The critic runs the probe directly via `spawnSync` from its own
  step, the same surface the other critic-adjacent checks use. Probes
  do not route through the agent tool loop, so they are not subject
  to the per-tool approval queue. Authors own their commands.
- The probe result lands as `runtime-probe.json` in the run directory
  and is threaded into the critic's prompt with instructions to treat
  failure as a critical issue unless the probe itself is miscalibrated.
- The critic still exercises calibrated judgment. It can accept a
  failed probe when the failure is environmental (network outage,
  missing binary) and unrelated to the staged change, but must
  justify that in the verdict `summary`.
