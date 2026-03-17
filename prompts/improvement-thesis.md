# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 548)

The loop's primary gap is the **feature-factory bias in the evaluation
criterion**, now confirmed by two iterations of failed lesson-based
interventions and validated by external research:

1. **Evaluation criterion is the bottleneck** (evolved from iter 546). The
   iter 546 intervention (broadened criterion + Quality Beyond Features lesson)
   FAILED — iter 547 builder listed module isolation as candidate #1 but
   dismissed it: "important but doesn't add capability." The builder evaluates
   all candidates through a feature-shaped lens because the criterion asks
   "what concrete outcome?" and features have more vivid outcomes. Iter 548
   restructures the criterion to make architecture outcomes as concrete as
   feature outcomes, validated by DGM research: "evaluation criteria determine
   behavior."

2. **Architecture quality untested**. The owner flagged that modules aren't
   truly self-contained (NOTES.md). 55+ source files, 8000+ lines, but no
   verification that the module system actually supports plug-and-play. This
   is the deeper quality dimension beyond composition testing.

3. **Efficiency is mature**. All interventions landed and verified. Cost trends
   stable ($4.52 in iter 547). Further efficiency work is diminishing returns.

4. **Prompt instruction density is safe**. Counted ~72 instruction-like lines
   across builder prompt (40) + lessons (32). Well below the 150-instruction
   threshold for reasoning models (arXiv 2507.11538). Room to add if needed.

**Previously addressed gaps:**
- Context growth: ADDRESSED (iter 538, verified iter 540). 97k → 63k (-35%).
- Rework: ADDRESSED (iters 536+538, verified iter 540). 76% → 36%.
- Web research waste: ADDRESSED (iter 540). No negative signal.
- Lint rework: ADDRESSED (iter 542, verified iter 544). Lint runs down ~35%.
- Composition testing: ADDRESSED (iter 544→545). 7 E2E tests covering
  multi-step workflows. Basic capability composition verified.

**Intervention history:**
- **(iter 534)** BUILDER_LESSONS.md with pre-flight health checks. **EFFECTIVE**.
- **(iter 536)** Consumer-first editing pattern. **VERIFIED**: rework 76% → 36%.
- **(iter 538)** Deferred source reads. **VERIFIED**: context -35%, cost -34%.
- **(iter 540)** Research strategy lesson. **INCONCLUSIVE**: no web research used
  since intervention. No negative signal.
- **(iter 542)** Lint batching lesson. **VERIFIED** (iter 544): lint runs dropped
  from 6.8× avg to ~4-5 in iter 543. Pattern followed: batch at boundaries.
- **(iter 544)** Composition-aware brainstorming + "Composition Gap" lesson.
  **VERIFIED** (iter 546): builder chose composition E2E tests in iter 545.
  7 tests covering code fix, error recovery, lint-gated edits, multi-turn,
  task+shell, parallel+sequential workflows. Clear success.
- **(iter 546)** Broadened evaluation criterion + "Quality Beyond Features"
  lesson. **FAILED** (iter 548): builder listed module isolation as #1 candidate
  but chose web page extraction feature instead, explicitly stating quality
  work "doesn't add capability." The lesson-based approach didn't change the
  evaluation calculus — the builder's mental model of "capability" was the
  bottleneck.
- **(iter 548)** Restructured evaluation criterion in builder prompt to make
  architecture outcomes as concrete as feature outcomes. Replaced "Quality
  Beyond Features" lesson with "Architecture as Capability" — outcome-oriented
  framing that links quality work to specific workflows it enables. Informed
  by DGM research: evaluation criteria determine behavior. Verify in iter 550:
  does the builder evaluate quality candidates as genuine capability work?

## Evidence

- **Feature factory confirmed**: 8/8 recent iters classified as "feature."
  Iter 547 explicitly dismissed quality work as "not adding capability" despite
  it being the #1 brainstorm candidate. The evaluation criterion structurally
  favors features — lessons alone cannot override this bias.
- **Iter 547 was efficient but still a feature**: 89 calls, $4.52, 31% rework
  (lowest ever), 0 errors, 35 new tests. Quality execution of a feature. The
  builder is skilled at building features — the question is whether it can be
  equally skilled at architecture work.
- **Lint batching holding**: Lint reruns at 5.4× in latest window (down from
  6.8× pre-intervention). Steady improvement.
- **Build pass rate**: 100% — necessary but not sufficient.
- **Tests**: 2938+ tests across the codebase. E2E composition tests (iter 545)
  verify multi-step workflows.
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).
- **Context trend (iters 533-545)**: 72k → 79k → 97k → 63k → 72k → 71k → 43k.
  Avg 71k. Iter 545's 43k shows focused work (test writing) uses less context.
- **Rework trend (iters 533-545)**: 63% → 76% → 68% → 36% → 51% → 33% → 45%.
  Avg 54%. Below 60% in 4 of last 5.
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
  - **GVU "Second Law" (Dec 2025, arXiv 2512.02731)**: Derives a Variance
    Inequality as a spectral condition for stable self-improvement. Core result:
    **when improvements plateau, strengthen the verifier (evaluation), not the
    generator (builder)**. Verification quality is the bottleneck. Applies to
    STaR, SPIN, Reflexion, AlphaZero — all are GVU operator instances.
  - **Prompt Instruction Limits (Feb 2026, arXiv 2507.11538)**: "How Many
    Instructions Can LLMs Follow at Once?" Three degradation patterns: threshold
    decay (~150 instructions for reasoning models), linear decay (claude-sonnet),
    exponential decay (gpt-4o). Accumulated instructions in agent prompts
    measurably degrade compliance. Monitor our prompt instruction density.
  - **EvolveR (Oct 2025, arXiv 2510.16079)**: Offline self-distillation —
    trajectories distilled into abstract principles, semantically deduplicated,
    scored by effectiveness. Bad principles decay; good ones propagate.
    Automated "prompt hygiene" for learned strategies. Directly applicable to
    BUILDER_LESSONS.md maintenance.
  - **AlphaEvolve (May 2025, arXiv 2506.13131)**: MAP-Elites + island-based
    population models. Less-performant "ancestor" agents instrumental in later
    breakthroughs — hill-climbing discards them prematurely. Self-evolves its
    own prompts. Implies: don't discard "failed" experiments.
  - **SWE-CI (Mar 2026, arXiv 2603.03823)**: First CI-loop benchmark —
    evaluates whether agent-produced code stays maintainable across evolving
    requirements (avg 233 days, 71 commits per task). Key insight: an agent
    that hard-codes a fix and one that writes clean code both pass the same
    test suite; the difference shows when the codebase must evolve.
  - **DGM Evaluation Insight (Sakana AI, 2025)**: Darwin Godel Machine's
    self-discovered improvements were primarily hardening (patch validation,
    tool reliability, failure history), NOT new features — raising SWE-bench
    from 20% to 50%. Key insight: **evaluation criteria determine behavior**.
    When scored on end-to-end task success, agents naturally invest in
    robustness over features. Directly validates our evaluation criterion
    restructuring (iter 548).
  - **CodeScene Quality Gates (2025)**: Embedding quantitative code health
    scores as blocking constraints in the agent loop. Loveholidays case: 0→40%
    AI-assisted code while maintaining quality. Approach: refactoring becomes
    "ambitious" when it has a numerical score to beat. Future direction for
    our loop if evaluation restructuring proves insufficient.
  - **Addy Osmani "80% Problem" (2025)**: Agents amplify the properties of
    the system they work in — better architecture → better agent output.
    Architecture work is self-reinforcing. Frame quality as "what enables
    the agent to produce better output."
  - **RefAgent (2025)**: Multi-agent refactoring pipeline achieving 90% test
    pass rate and 52.5% code smell reduction. Key: decompose refactoring into
    plan-then-validate steps with the same structure as feature work.
  - **Metacognitive Self-Improvement (arXiv 2506.05109)**: Truly self-improving
    agents need intrinsic metacognitive learning — ability to evaluate own
    capabilities and adapt strategy. Without it, agents default to repeating
    what produced positive signals last time (features).

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
| Multi-turn conversation | ✓ | Composition E2E |
| Error recovery in agent loop | ✓ | Composition E2E |
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
- **Lesson-only behavioral change**: Adding BUILDER_LESSONS.md entries that
  say "consider doing X" doesn't override the builder's evaluation calculus.
  The builder reads the lesson, acknowledges it, then evaluates candidates
  using the prompt's criterion — which may structurally favor the opposite.
  Lessons work for procedural patterns (lint batching, consumer-first edits)
  but fail for strategic decisions (what to work on). For strategic change,
  modify the evaluation criterion itself, not the lessons.
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
  and evaluation criterion sharpening. **VERIFIED** (iter 546): builder chose
  composition E2E tests in iter 545. 7 tests, 40 calls, $1.79. Clear success.
- **Quality-focused evaluation criterion (iter 546)**: Broadened evaluation from
  "what workflow does this enable?" to also value "what weakness does this
  address?". Replaced "Composition Gap" lesson with "Quality Beyond Features"
  in BUILDER_LESSONS.md. **FAILED** (iter 548): builder brainstormed module
  isolation as #1 candidate but dismissed it as "doesn't add capability" and
  chose a feature instead. Lesson-based approach insufficient — the evaluation
  criterion itself frames all decisions through a feature lens.
- **Evaluation criterion restructuring (iter 548)**: Changed the evaluation
  question from "what concrete outcome?" (feature-biased) to "what does this
  make possible that wasn't possible before?" (neutral). Made architecture
  outcomes as concrete as feature outcomes with equal-quality examples. Replaced
  "Quality Beyond Features" lesson with "Architecture as Capability" — links
  quality work to specific workflows it enables. **Verify in iter 550**: does
  the builder evaluate quality candidates as genuine capability work?

## Strategic Priorities (for the improver, not the builder)

1. **Break feature-factory bias** — IN PROGRESS (iter 548). Evaluation criterion
   restructured. The lesson-based approach failed twice (iters 544, 546). The
   criterion change targets the root cause: the builder's mental model of
   "capability." If iter 549 still chooses a feature over quality work, consider
   CodeScene-style quantitative quality gates as a blocking constraint.
2. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation is the single
   highest-leverage unlock. Even cheap Haiku-based scenario tests would give
   real capability signal.
3. **Strengthen evaluation per GVU theory** — The "Second Law" (arXiv
   2512.02731) says: when improvements plateau, strengthen the verifier. Our
   evaluation is binary (tests pass/fail) + metrics (cost/rework). DGM research
   confirms: evaluation criteria determine behavior. Multi-dimensional
   evaluation (maintainability, architecture fitness) would give better signal.
4. **Cross-iteration learning** — **MATURE**: BUILDER_LESSONS.md implements
   Reflexion-style persistent knowledge. 7 lessons. Combined effect: rework
   76% → 36%, context 97k → 63k, lint runs -35%. Instruction count (72)
   is safely below the 150-instruction degradation threshold.
5. **Escalation plan if criterion change fails**: If the builder still
   systematically chooses features after iter 548's intervention, the next
   move is quantitative quality scoring — embed a measurable architecture
   metric (e.g., core import count, cross-module coupling) that the builder
   can "beat," inspired by CodeScene's approach. Agents optimize what they
   can measure.
