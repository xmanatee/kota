# Autonomy Module

This module owns the project autonomous development loop.

- Keep the autonomous workflows and their helpers inside this module; do
  not recreate a parallel workflow catalog in core.
- Durable autonomous learning belongs in scoped `AGENTS.md` at the
  narrowest useful directory. Evidence lives in run artifacts and git
  history; no second lessons store or injected summaries.
- Promote a lesson only when repeated run evidence shows a durable pattern;
  retract or narrow when code, behavior, or ownership changes.
- Workflow prompts stay role-focused. Shared policy belongs in this
  module's `AGENTS.md` hierarchy.
- Shipped autonomy workflows declare their harness in code so the repo
  boots cleanly without an operator `.kota/config.json`. Generic project
  workflows may still inherit `KotaConfig.defaultAgentHarness`.
- Judges inside a repair loop inherit the parent step's resolved harness, not
  a parallel fallback.

## Core Autonomy Decisions

Load-bearing rules from harness, eval, and peer-runtime research. Post
summaries live in run artifacts or `data/watchlist.yaml`.

- **Generator / evaluator separation.** Decomposer → builder → critic.
  Strip repair-loop checks first; keep roles.
- **Evaluator probes outcomes, not just artifacts.** Diff-only review is
  blind to runtime behavior; reduce success to an inspectable artifact
  or carry a runtime probe (see `workflows/builder/AGENTS.md`).
- **Critic input stays artifact-only.** Diff + repo state + run
  artifacts (+ optional runtime probe). No thinking traces or
  self-reports.
- **Infrastructure noise is not statistical noise.** Split allocation
  from kill thresholds, report resource profile, distinguish `pass@k`
  from `pass^k`. Judge-repetition per fixture belongs here too.
- **Context resets beat compaction.** Prefer fresh-session handoffs via
  run artifacts over in-session compaction for distinct-phase workflows.
- **Untrusted content is an injection surface.** Tool-risk gating
  classifies the call, not the payload; `injection-defense` screens the
  payload.
- **Session state reconstructible from append-only logs.** Write through
  to run artifacts or the event bus.
- **Eval fixtures come from real failures.** Seed `eval-harness` from
  `.kota/runs/`, not synthetic.

## Live-Run Evaluator Calibration

Fixture `pass^k` catches generator drift; per-run artifacts catch
evaluator drift. Failure signal: `verdict==="fail"` or
`criticFailureCount>0`. Mechanical repair is iteration noise. PWW
escalation needs later overlap also failing. Drifts commit one path:
create/recreate/promote `task-evaluator-calibration-drift-repair` in
`ready/`; regression bridges to attention digest. Critic blocks weak
rendered evidence, placeholder tests, untracked compat shims,
baseline-only ratchets, required-source dishonesty.

## External Pattern Decisions

Verdicts on peer patterns vs KOTA primitives. Per-verdict source, date,
primitives, and revisit live in `external-pattern-decisions.ts`; the
test enforces 1:1 match.

- **Workflow DSLs (crewAI Flows, LangGraph Pregel).** Reject.
- **Vercel AI SDK split.** Adopt — `daemon` + `client`.
- **Typed multi-agent handoffs (OpenHands, AutoGen).** Adopt — bus + `trigger` steps.
- **Labeled memory blocks (Letta) / runtime skill stores (Hermes).** Reject.
- **Verbal self-reflection / strategy banks (Reflexion, ReasoningBank).** Reject.
- **Routines / scheduled agents.** Already the `workflow` trigger.
- **Multi-agent coordination patterns.** Map to builder/critic + bus + stores.
- **Parallel-agent desktop UIs.** Client-surface — new clients use daemon API.
- **Managed Agents / brain-hands decoupling.** Reject.
- **Claude Code auto mode + sandboxing.** Read.
- **Harness design for long-running apps.** Read.
- **Multi-Claude parallel builds.** Reject — one-task-WIP.
- **Claude Code 1M context + session management.** Reject — reset-over-compact.
- **Production MCP agent integration.** Read.
- **AGI capability scoring / behavioral-disposition alignment.** Reject.
- **Microsoft Agent Framework (AutoGen successor).** Reject — graph-DSL.
- **Harness-as-shell (inference.sh).** Read.

## Prompt Hierarchy And Harness Posture

- **Instruction hierarchy.** SDK system + core rails ≈ Root/System;
  autonomy mode + module prompt state ≈ Developer; channel/session user
  message ≈ User; tool/web outputs ≈ untrusted (via `injection-defense`).
  User/tool output must not silently escalate autonomy mode.
- **Trustworthy-agents four-layer injection defense.** Model/harness ≈
  SDK boundary; tools ≈ `guardrails.ts` + risk; runtime ≈
  `approval-queue` + autonomy mode + `injection-defense`.
- **Opus 4.7 harness defaults at agent-step layer.** Delegate-don't-pair
  (front-load intent, constraints, success criteria in one turn), `xhigh`
  default, adaptive thinking, batch-upfront, judicious subagent spawning
  (explicit builder→critic steps). Task contract + success-criteria
  files enforce this; no clarification loops or fixed reasoning caps.
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
`task-classification.classifyTaskShape` and inspects area + title +
summary so surface-parity work filed under `architecture` / `modules`
(macOS picker, web-UI form, Telegram command) classifies as fan-out.
Per no-cost-bias-in-autonomy this output is operator-only and must not
be exposed to autonomy agents.

## Multi-Client Fan-Out Consolidation

`fan-out-consolidator` deterministically seeds one consolidation review
task per completed multi-client fan-out batch. Detection + body live in
`fan-out-consolidation.ts`; idempotent by capability key and counts at
most one primary surface per closed task. Seeded task is `area: client`
so the rendered-evidence gate rejects clearing it with prose-only test
logs.

## Empty-Queue Loop Shape

Deliberate workflow gating, not emergent dispatcher → explorer →
builder thrash:

- **Builder gates on `autonomy.queue.available`** (actionable=
  ready+doing>0). Never fires on `runtime.idle`, never auto-consumes
  backlog.
- **`backlog-promoter` records `promotion-rationale.json`** before
  builder resumes. Runs on `autonomy.queue.needs-promotion`, promotes
  one or two backlog tasks ranked by priority → strategic-area →
  oldest `updated_at`.
- **`explorer` repair-loop rejects commits without
  `exploration-rationale.json`** naming the decision (promote |
  decompose | create-task | noop | watchlist-only). `create-task`
  must consider every strategic-area blocked task by id.
- **Cooldowns over caps.** Explorer 30-minute refresh; builder rate-
  limited only by repair checks and task availability. No daily spend
  caps.
- **Honesty over speculation.** Inaccessible sources still block
  (`done-task-inaccessible-source`); no synthesis from unread content.

## Agent Judge Runtime Contract

The shared agent-step retry classifier (see
`src/core/workflow/steps/AGENTS.md`) governs autonomy judges. Judge-
backed repair checks (critic, improver semantic gate) catch runaway
turn/token throws and return a warning — editing code cannot shrink
a judge's budget — while the primitive still throws. Unclassified SDK
failures reject the check.
