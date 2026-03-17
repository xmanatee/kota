# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 544)

The loop's primary gap is now **evaluation quality, not efficiency**:

1. **Feature factory without composition testing** (evolved from "no capability
   evaluation", iter 532). The builder consistently ships features (6/6 recent
   iters), all pass unit tests, but no verification that capabilities compose
   into working multi-step workflows. SWE-EVO (arXiv 2512.18470) confirms this
   is a real risk: GPT-5 scores 65% on single-patch SWE-bench but only 21% on
   multi-release evolution — composition is dramatically harder than individual
   tasks. Iter 544 intervention adds composition to the builder's brainstorm
   categories and evaluation criteria.

2. **Efficiency is no longer the bottleneck**. All efficiency interventions have
   landed: rework 33% (best in window), context 71k (stable), cost $3.88
   (lowest in window), lint runs down ~35% post-batching lesson. Further
   efficiency gains are diminishing returns.

**Previously addressed gaps:**
- Context growth: ADDRESSED (iter 538, verified iter 540). 97k → 63k (-35%).
- Rework: ADDRESSED (iters 536+538, verified iter 540). 76% → 36%.
- Web research waste: ADDRESSED (iter 540). No negative signal.
- Lint rework: ADDRESSED (iter 542, verified iter 544). Lint runs dropped from
  6.8× avg to ~4-5 in iter 543 (~35% reduction).

**Intervention history:**
- **(iter 534)** BUILDER_LESSONS.md with pre-flight health checks. **EFFECTIVE**.
- **(iter 536)** Consumer-first editing pattern. **VERIFIED**: rework 76% → 36%.
- **(iter 538)** Deferred source reads. **VERIFIED**: context -35%, cost -34%.
- **(iter 540)** Research strategy lesson. **INCONCLUSIVE**: no web research used
  since intervention. No negative signal.
- **(iter 542)** Lint batching lesson. **VERIFIED** (iter 544): lint runs dropped
  from 6.8× avg to ~4-5 in iter 543. Pattern followed: batch at boundaries.
- **(iter 544)** Composition-aware brainstorming + "Composition Gap" lesson.
  **Verify in iter 546**: did the builder choose composition/integration work
  over another standalone feature?

## Evidence

- **Feature factory pattern**: 6/6 recent builder iters are standalone features.
  All pass unit tests. None verify capability composition. The builder's
  brainstorm consistently produces infrastructure features because they're
  individually testable — the evaluation signal (tests pass) rewards adding
  capabilities, not proving they compose.
- **Iter 543 was highly efficient**: 92 calls, $3.88, 33% rework, 71k context.
  Best cost and rework in 6-iteration window. Efficiency interventions have
  converged — further gains are diminishing returns.
- **Lint batching verified**: Iter 543 had 4-5 lint calls vs 6.8× avg before
  intervention. Builder followed the batching pattern without prompting.
- **Build pass rate**: 100% — necessary but not sufficient.
- **Tests**: Mostly unit-level. E2E tests (iter 533) test plumbing, not
  capability composition. 2896 tests across 127 files.
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).
- **Context trend (iters 533-543)**: 72k → 79k → 97k → 63k → 72k → 71k.
  Stable at ~74k avg post-deferred-read intervention.
- **Rework trend (iters 533-543)**: 63% → 76% → 68% → 36% → 51% → 33%.
  Trending down. Below 60% target in 3 of last 4.
- **SWE-EVO gap** (new research, iter 544): Agents that pass single-task
  benchmarks fail at sustained composition. GPT-5: 65% SWE-bench → 21%
  SWE-EVO. This directly parallels our situation: unit tests pass, but
  multi-step workflows are untested.
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
  - **SWE-EVO (Dec 2025, arXiv 2512.18470)**: Long-horizon software evolution
    benchmark. GPT-5 + OpenHands: 65% SWE-bench → 21% SWE-EVO. Confirms that
    single-task evaluation dramatically overstates capability for sustained,
    compositional work. Directly applicable: our builder passes unit tests but
    multi-step composition is untested.
  - **AgentRewardBench (Apr 2025, arXiv 2504.08942)**: Offline trace evaluation
    — judge recorded agent trajectories without re-executing. 1,302 annotated
    trajectories across 5 benchmarks. Practical approach for evaluating agent
    quality from session logs.
  - **AgentPRM (Feb 2025, arXiv 2502.10325)**: Process Reward Models for LLM
    agents. Monte Carlo rollouts from each intermediate state estimate per-step
    value. Fine-grained quality signals without full task completion.

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
- **Lint batching intervention (iter 542)**: Added lint efficiency lesson.
  **VERIFIED** (iter 544): lint runs dropped from 6.8× avg to ~4-5 in iter 543.
- **Composition-aware brainstorming (iter 544)**: Added "Composition Gap" lesson
  to BUILDER_LESSONS.md and capability-composition category to builder prompt's
  brainstorm section. Sharpened evaluation criterion to require concrete
  multi-step workflow impact. **Verify in iter 546**: did the builder choose
  composition/integration work?

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
