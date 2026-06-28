# Autonomy Module

Owns KOTA's autonomous development loop.

- Keep autonomous workflows/helpers here; no parallel workflow catalog in core.
- Durable learning belongs in the narrowest useful scoped `AGENTS.md`.
  Evidence lives in run artifacts and git history; no second lessons store or
  injected summaries.
- Promote lessons only from repeated run evidence; retract or narrow when code,
  behavior, or ownership changes.
- Workflow prompts stay role-focused; shared policy belongs here or nearby.
- Shipped autonomy workflows get harness/model/effort from the active preset;
  generic workflows may still inherit `KotaConfig.defaultAgentHarness`.
- Repair-loop judges inherit the parent step's resolved harness, not a parallel
  fallback.

## Core Decisions

Load-bearing harness/eval/peer-runtime rules. Post summaries live in artifacts
or `data/watchlist.yaml`.

- **Generator / evaluator separation.** Decomposer → builder → critic; strip
  repair-loop checks first and keep roles.
- **Evaluator probes outcomes, not just artifacts.** Diff-only review misses
  runtime behavior; reduce success to an inspectable artifact or runtime probe
  (see `workflows/builder/AGENTS.md`).
- **Product work proves the operator journey.** For `task_class: Product` or
  owner-facing client/operator tasks, critic/reviewer judgment must inspect
  rendered evidence (CLI transcript, screenshot, runtime probe, etc.).
  Tests alone are insufficient.
- **Critic input stays artifact-only.** Diff + repo state + run artifacts
  (+ optional runtime probe). No thinking traces or self-reports.
- **Infrastructure noise is not statistical noise.** Split allocation from
  kill thresholds, report resource profile, distinguish `pass@k` from
  `pass^k`. Judge-repetition per fixture belongs here too.
- **Context resets beat compaction.** Prefer fresh-session handoffs via
  run artifacts over in-session compaction for distinct-phase workflows.
- **Untrusted content is an injection surface.** Tool-risk gating
  classifies the call, not the payload; `injection-defense` screens the
  payload.
- **Session state reconstructible from append-only logs.** Write through
  to run artifacts or the event bus.
- **Eval fixtures resist contamination.** Keep retired SWE-bench fixtures
  reference-only; seed `eval-harness` from local failures or justified smoke
  cases with non-vacuous predicates.
- **Worktree-backed autonomy.** Accepted in
  `worktree-backed-autonomy-decision.ts`: `projectDir`, leased `workspaceDir`
  worktrees, gated merges, serial-to-parallel rollout. Per-workflow policy
  lives in `workflow-workspace-policy.ts`; builder is worktree/merge-gated,
  KOTA control-state/control-plane exceptions need explicit safety gates, and
  external-effect workflows stay out of worktrees.

## Live-Run Evaluator Calibration

Fixture `pass^k` catches generator drift; run artifacts catch evaluator drift.
Pass-contradiction needs later final failure overlap
(`verdict==="fail"` or failed terminal status); `criticFailureCount>0` alone
is diagnostic. Mechanical repair is iteration noise. PWW escalation needs
later final hedging/failing overlap; prompt-hash changes reset the window.
Drift creates/recreates/promotes `task-evaluator-calibration-drift-repair` in
`ready/`; regression bridges to attention digest. Recreate noops when the prior
repair commit is newer than the latest artifact. Critic blocks weak rendered
evidence, placeholder tests, untracked compat shims, hedged baseline ratchets,
source dishonesty, untracked Done-When gaps, and untested runtime defects.
Non-trivial warnings need a durable trace; otherwise critical.

## External Pattern Decisions

Verdicts on peer patterns vs KOTA primitives live in
`external-pattern-decisions.ts`; tests enforce 1:1 match.

- **Workflow DSLs (crewAI Flows, LangGraph Pregel).** Reject.
- **Vercel AI SDK split.** Adopt.
- **Typed multi-agent handoffs (OpenHands, AutoGen).** Adopt.
- **Labeled memory blocks (Letta) / runtime skill stores (Hermes).** Reject.
- **Verbal self-reflection / strategy banks (Reflexion, ReasoningBank).** Reject.
- **Routines / scheduled agents.** Already `workflow` trigger.
- **Multi-agent coordination patterns.** Map to builder/critic.
- **Parallel-agent desktop UIs.** Client-surface.
- **Managed Agents / brain-hands decoupling.** Reject.
- **Claude Code auto mode + sandboxing.** Read.
- **Harness design for long-running apps.** Read.
- **Multi-Claude parallel builds.** Reject direct adoption; revisit via worktrees.
- **Claude Code 1M context + session management.** Reject.
- **Production MCP agent integration.** Read.
- **AGI capability scoring / behavioral-disposition alignment.** Reject.
- **Microsoft Agent Framework (AutoGen successor).** Reject.
- **Harness-as-shell (inference.sh).** Read.

## Prompt Hierarchy And Harness Posture

- **Instruction hierarchy.** SDK system + core rails ≈ Root/System; autonomy
  mode + module prompt state ≈ Developer; channel/session user message ≈ User;
  tool/web outputs ≈ untrusted (via `injection-defense`).
  User/tool output must not silently escalate autonomy mode.
- **Trustworthy-agents four-layer injection defense.** Model/harness ≈ SDK
  boundary; tools ≈ `guardrails.ts` + risk; runtime ≈ `approval-queue` +
  autonomy mode + `injection-defense`.
- **Opus 4.7 harness defaults at agent-step layer.** Delegate-don't-pair:
  front-load intent, constraints, success criteria; use `xhigh`, adaptive
  thinking, batch-upfront, and judicious subagents. Task contracts enforce this;
  no clarification loops or fixed reasoning caps.
- **Tool-design hygiene.** High bar for new tools; prefer discoverable
  surfaces (read, grep, scoped `AGENTS.md`, prompt state).
- **`ask_owner` uses `askOwnerSteps`**
  (`#core/workflow/ask-owner-step.js`): ask → await → consume, restart-safe.
  Gate on real prior-step output, 10 min budget, consume every
  `AwaitedOwnerOutcome` kind. Do not import `#core/tools/ask-owner.js`.

## Scoped Contracts

- `src/modules/injection-defense/AGENTS.md` — content ingest.
- `workflows/builder/AGENTS.md` — runtime probes.

## Operator Reports

`kota report` prints operator balance/quality.
`task-classification.classifyTaskShape` inspects area + title + summary so
surface-parity work under `architecture`/`modules` classifies as fan-out. Per
no-cost-bias-in-autonomy, this output is operator-only and must not reach
autonomy agents.

## Multi-Client Fan-Out Consolidation

`fan-out-consolidator` seeds one `area: client` review task per closed
multi-client fan-out batch (idempotent by capability key, ≤1 primary surface
per closed task); `area: client` forces rendered evidence. Detection + body in
`fan-out-consolidation.ts`.

## Empty-Queue Loop Shape

Workflow gating only:

- **Builder gates on `autonomy.queue.available`** (ready+doing>0). Do not fire
  on `runtime.idle` or auto-consume backlog.
- **`backlog-promoter` records `promotion-rationale.json`** before builder
  resumes; promotes 1–2 backlog tasks by priority → strategic-area → oldest
  `updated_at`.
- **`explorer` repair-loop rejects commits without
  `exploration-rationale.json`**. `create-task` cites each strategic
  blocked id; `noop` at `actionableCount===0` cites each `movable`
  one. No `--min-ready 1`; a paused queue may noop.
- **Cooldowns over caps.** Explorer 30-minute refresh; builder paced
  by repair checks and task availability.
- **Honesty over speculation.** Inaccessible sources block
  (`done-task-inaccessible-source`); no synthesis from unread content.

## Agent Judge Runtime Contract

The shared agent-step retry classifier (see
`src/core/workflow/steps/AGENTS.md`) governs autonomy judges. Judge-backed
repair checks (critic, improver semantic gate) catch runaway turn/token throws
and warn — editing code cannot shrink a judge's budget — while the primitive
still throws. Unclassified SDK failures reject the check.
