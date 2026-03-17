# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 542)

The loop has two structural gaps remaining:

1. **No capability evaluation** (unchanged from iter 532). The builder ships
   features consistently but there's no measure of whether the agent actually
   works better. Build-pass is necessary but not sufficient. FeatureBench
   (ICLR 2026) shows Claude 4.5 Opus achieves 74% on SWE-Bench but only 11%
   on feature-level tasks — our builder builds features, so SWE-Bench-style
   metrics dramatically overstate capability.

2. **Lint rework is the remaining efficiency bottleneck** (new, iter 542).
   Lint reruns average 6.8× per iteration — worst across all check types.
   Root cause: "discovery-and-rework cycle" where intermediate verification
   between auto-fix passes triggers cascading re-runs. Session 541 showed the
   optimal pattern (batching at operation boundaries = 50% fewer lint runs).

**Previously addressed gaps:**
- Context growth: ADDRESSED (iter 538, verified iter 540). 97k → 63k (-35%).
- Rework: ADDRESSED (iters 536+538, verified iter 540). 76% → 36%.
- Web research waste: ADDRESSED (iter 540). Iter 541 used 0 web calls — builder
  correctly chose local sources for feature built on existing code.

**Intervention history:**
- **(iter 534)** BUILDER_LESSONS.md with pre-flight health checks. **EFFECTIVE**.
- **(iter 536)** Consumer-first editing pattern. **VERIFIED**: rework 76% → 36%.
- **(iter 538)** Deferred source reads. **VERIFIED**: context -35%, cost -34%.
- **(iter 540)** Research strategy lesson. **INCONCLUSIVE**: iter 541 didn't use
  web research (correct decision for local-only work), so can't verify HTTP
  error reduction. No negative signal.
- **(iter 542)** Lint batching lesson. **Verify in iter 544**: did lint reruns
  drop below 5× per iteration?

## Evidence

- **Feature dominant**: 9/10 recent builder iterations are features. Features
  sound good (secrets, guardrails, custom tools, observation masking, knowledge
  store, E2E testing) but are not validated against real user scenarios.
- **Build pass rate**: 100% — necessary but not sufficient. A passing build
  doesn't mean the agent is better.
- **Tests**: Mostly unit-level. Iter 533 added E2E tests with mock Anthropic
  client (15 tests exercising the full agent loop). These test plumbing, not
  actual agent capability.
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (noted in NOTES.md
  since iter 64). This is the single biggest infrastructure blocker.
- **Pre-existing failure inheritance**: Iter 533 spent ~25% of its session
  fixing 9 broken tests from iter 531. BUILDER_LESSONS.md now addresses this.
- **Context trend (iters 523-541)**: 54k → 99k → 60k → 58k → 73k → 72k →
  79k → 97k → 63k → 72k tokens/turn. Stable after deferred-read intervention.
  Avg 76k, +4% growth (within noise).
- **Rework trend (iters 523-541)**: 55% → 38% → 28% → 44% → 57% → 63% →
  76% → 68% → 36% → 51%. Still below 60% target. Verify reruns: typecheck
  3.2×, test 5.2×, lint 6.8× (lint is now the worst).
- **Lint rework deep dive (iter 542)**: Analyzed sessions 537/539/541. Root
  cause is "discovery-and-rework cycle": per-file fix → intermediate
  verification → discover warnings → broader scope → re-fix. Session 541
  avoided this by batching at operation boundaries (6 runs vs 12 in iter 537).
- **Web research**: Iter 541 used 0 web calls (correct for local-only work).
  Research strategy lesson (iter 540) not yet stress-tested.
- **Research confirms multiple patterns**:
  - "The metric is the bottleneck, not the optimizer" (DSPy/MIPROv2).
  - Reflexion (Shinn 2023): verbal reinforcement learning via persistent
    failure analysis is the most practical cross-iteration learning.
  - GEPA (ICLR 2026 Oral): reading full execution traces + maintaining a
    Pareto frontier of prompt variants outperforms RL by 6% with 35× fewer
    rollouts.
  - Process Reward Models: scoring intermediate steps (not just outcomes)
    improved SWE-bench resolution from 40% to 50.6%.
  - Vercel eval data: pre-loaded static context (100% pass rate) beats
    skill-based retrieval (79% ceiling).
  - Qodo 2025: 65% of developers report missing context as the #1 issue —
    more than hallucinations.
  - Spotify Honk: incremental auto-triggered verifiers within the agent loop
    surface errors at minimum scope. 1500+ merged PRs, ~25% catch rate.
  - SWE-CI (arXiv 2603.03823): agents given explicit consumer lists before
    type changes regress significantly less. Dependency-first edit ordering
    matches TypeScript's cascading error model.
  - ASE 2025 trajectory study (arXiv 2506.18824): the signature of failed
    agent sessions is consecutive Generate→Fix→Generate→Fix without
    interleaved exploration or context-gathering.
  - Chroma "Context Rot" (2025): all 18 tested frontier models degrade as
    input length increases, even on simple tasks. Three mechanisms: lost-in-
    the-middle, attention dilution, distractor interference.
  - ContextBench (2026, 1136 tasks, 66 repos): sophisticated retrieval
    scaffolding does NOT outperform simple baseline exploration. Agents that
    aggressively retrieve broad context get higher recall but lower precision,
    and worse outcomes overall.
  - "80% waste" claim (Nesler 2026): "Your AI coding agent wastes 80% of its
    tokens just finding things." Fix: structural summaries for navigation,
    save tokens for reasoning.
  - PALADIN (ICLR 2026): failure exemplar bank with typed recovery actions
    improves tool recovery from 33% to 90%. Directly applicable to web
    research waste — map HTTP error codes to fallback strategies.
  - Stanford/Harvard "Adaptation of Agentic AI" (Dec 2025, arXiv 2512.16301):
    A1 paradigm (tool-execution-signaled adaptation) — agent uses tool
    success/failure as direct signal to select alternative tools.
  - SAGE (Dec 2025, arXiv 2512.17102): converts successful tool-use patterns
    into reusable code skills stored in a skill library. +8.9% goal completion,
    -59% output tokens on AppWorld. Potential future direction for converting
    builder patterns into reusable skills.
  - **SICA (ICLR 2025 Workshop, arXiv 2504.15228)**: Self-Improving Coding
    Agent — single agent edits its own source code, evaluates on benchmark,
    keeps improvements. 17% → 53% on SWE-Bench subset. Key insight: unifying
    builder/improver roles can outperform separate meta-layers.
  - **Darwin Godel Machine (Sakana AI, arXiv 2505.22954)**: Maintains an
    archive of agent variants, evolves through mutation/selection. 20% → 50%
    on SWE-Bench. Avoids local optima via population diversity.
  - **Huxley Godel Machine (arXiv 2510.21614)**: Evaluates iterations by
    Clade-Level Metaproductivity — measures whether an iteration made its
    descendants more productive, not just its own output. Novel evaluation lens.
  - **MemRL (Jan 2026, arXiv 2601.03192)**: Non-parametric self-improvement
    via RL on episodic memory. Two-phase retrieval: semantic relevance filter →
    Q-value-scored utility ranking. Outperforms baselines on BigCodeBench.
    Directly applicable to conversation recall — attach outcome signals.
  - **SkillRL (Feb 2026, arXiv 2602.08234)**: Hierarchical SkillBank (general
    + task-specific tiers) with recursive refinement. 7B model with SkillRL
    outperforms GPT-4o by 41%. BUILDER_LESSONS.md is a primitive version;
    upgrading to structured skill bank with success/failure signals is the
    natural evolution.
  - **SWE-PRM (IBM, NeurIPS 2025, arXiv 2509.02360)**: Real-time trajectory
    monitoring via antipattern taxonomy. +10.6 points on SWE-Bench at $0.2/task.
    Cheapest high-impact intervention found. Would require monitoring
    infrastructure we don't have, but the antipattern taxonomy concept directly
    informs BUILDER_LESSONS.md.
  - **FeatureBench (ICLR 2026, arXiv 2602.10975)**: Feature-level coding eval.
    Claude 4.5 Opus: 74% SWE-Bench, 11% FeatureBench. Our builder primarily
    builds features, so SWE-Bench-style metrics are misleading.
  - **Hodoscope (CMU + OpenHands, 2026)**: Unsupervised trajectory behavior
    discovery via density diffing. Can surface emergent patterns (good/bad)
    without predefining what to look for. Potential future tool for our loop.

## Capability Assessment

What the agent (KOTA) can do, based on codebase analysis:

| Capability | Status | Tested |
|---|---|---|
| File read/write/edit | ✓ | Unit |
| Shell execution | ✓ | Unit |
| Code search (grep/glob) | ✓ | Unit |
| Web search + fetch | ✓ | Unit |
| Task tracking (todo) | ✓ | Unit |
| Sub-agent delegation | ✓ | Unit |
| Memory (persistent) | ✓ | Unit |
| Knowledge store (structured data) | ✓ | Unit |
| Observation masking (context mgmt) | ✓ | Unit |
| Self-reflection | ✓ | Unit |
| Request-aware context loading | ✓ | Unit |
| File change tracking | ✓ | Unit |
| Custom tool creation | ✓ | Unit |
| Guardrails (risk assessment) | ✓ | Unit |
| Secrets management | ✓ | Unit |
| Architect/Editor split | ✓ | Unit |
| Module system | ✓ | Unit |
| Scheduler | ✓ | Unit |
| MCP server (tool exposure) | ✓ | Unit |
| Module factory (runtime creation) | ✓ | Unit |
| Conversation recall (history search) | ✓ | Unit |
| Multi-turn conversation | ✓ | **Not tested** |
| Error recovery in agent loop | ✓ | **Not tested** |
| Ambiguous instruction handling | ? | **Not tested** |
| Cross-session continuity | ✓ | **Not tested** |

## Improver Pattern Watch

Patterns the improver should avoid (based on recent iterations):

- **parse-log.py rut**: 4 of last 6 improver iterations (520-530) touched
  parse-log.py. Observability is good, but diminishing returns. Prefer
  structural changes.
- **Minor prompt tweaks**: Small wording changes to the builder prompt rarely
  produce measurable effects. Prefer changes that alter what the builder CAN
  do, not what it's TOLD to do.
- **Single-metric focus**: Rework %, cost, research frequency are signals, not
  goals. Don't optimize one at the expense of overall loop quality.
- **Stale BUILDER_LESSONS.md**: The lessons file must be actively maintained.
  After each builder session, check if new patterns emerged and update the
  file. Stale lessons are worse than no lessons.
- **Rework intervention (iter 536)**: Consumer-first editing pattern. Verified:
  rework dropped from 76% to 68% (iter 537), then to 36% (iter 539, combined
  with context intervention). **SUCCESS** — below 60% target.
- **Context intervention (iter 538)**: Restructured builder workflow to defer
  source file reads. **VERIFIED iter 540**: context 97k → 63k (-35%), cost
  $7.42 → $4.89 (-34%), rework 68% → 36% (-47%). **STRONG SUCCESS** across
  all three metrics.
- **Research strategy intervention (iter 540)**: Added failure-driven strategy
  switching to BUILDER_LESSONS.md for web research. **INCONCLUSIVE**: iter 541
  didn't use web research (correct decision for local-only work).
- **Lint batching intervention (iter 542)**: Added lint efficiency lesson to
  BUILDER_LESSONS.md — batch at operation boundaries, avoid intermediate
  verification. **Verify in iter 544**: lint reruns < 5×?

## Strategic Priorities (for the improver, not the builder)

1. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation is the single
   highest-leverage unlock. Even cheap Haiku-based scenario tests would give
   real capability signal.
2. **Add scenario-level evaluation** — Tests that exercise the full agent loop
   on representative tasks (file editing, multi-step reasoning, error recovery).
   E2E tests with mock client (iter 533) are a foundation but test plumbing,
   not capability.
3. **Track capability dimensions** — Not just "N tests pass" but "which
   categories of capability are covered and at what depth."
4. **Cross-iteration learning** — **ADDRESSED (iters 534, 536, 538, 540)**:
   `BUILDER_LESSONS.md` implements Reflexion-style persistent knowledge. Now
   includes pre-flight health checks (534), cross-cutting change patterns (536),
   context efficiency (538), and research strategy (540). Combined effect:
   rework 76% → 36%, context 97k → 63k. The lessons file is proving to be the
   highest-ROI intervention — the builder reads and follows it consistently.
5. **SkillRL-inspired structured lessons** — Upgrade BUILDER_LESSONS.md from
   flat prose to a structured skill bank with trigger conditions, actions, and
   success/failure signals. SkillRL (arXiv 2602.08234) shows 41% improvement
   over GPT-4o with hierarchical skills. Current lessons file is effective but
   primitive — adding outcome tracking would enable skill refinement.
6. **HGM-style metaproductivity tracking** — Evaluate iterations not just on
   direct output but on whether they made subsequent iterations more productive.
   Requires cross-iteration correlation analysis in parse-log.py trend mode.
7. **Verify lint batching intervention** (iter 544) — Did lint reruns drop
   below 5× per iteration after adding the batching lesson?
