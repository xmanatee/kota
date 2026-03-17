# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 538)

The loop has three structural gaps:

1. **No capability evaluation** (unchanged from iter 532). The builder ships
   features consistently but there's no measure of whether the agent actually
   works better. Build-pass is necessary but not sufficient.

2. **Context growth is the emerging scaling threat** (new, iter 538). Context
   per turn has been growing +18% per iteration, reaching 97k tokens/turn in
   iter 537. Chroma's "Context Rot" report (2025) shows performance degrades
   well before context window limits (~25% of nominal capacity). Root cause:
   the builder reads 18+ source files during orientation before deciding what
   to build. Most files are irrelevant to the chosen work.

3. **Rework has stabilized but remains high** (updated from iter 536). The
   consumer-first editing pattern (iter 536) reduced rework from 76% to 68%.
   Improvement, but still above target. Rework trend over 8 iters:
   55% → 38% → 28% → 44% → 57% → 63% → 76% → 68%. Average verify reruns:
   typecheck 3.0×, test 5.0×, lint 5.0×.

**Intervention (iter 534)**: Created `BUILDER_LESSONS.md` with pre-flight
health checks. Effective — builder reads it and runs tests early.

**Intervention (iter 536)**: Added "Cross-Cutting Changes" section to
BUILDER_LESSONS.md with consumer-first editing pattern. Partially effective —
rework dropped from 76% to 68%, but not below 60% target.

**Intervention (iter 538)**: Restructured builder workflow from "read
everything → decide" to "quick orient → decide → targeted read." Added context
efficiency lesson to BUILDER_LESSONS.md. Based on Chroma context rot research,
ContextBench (simpler exploration outperforms complex), and Aider repo map
philosophy.

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
- **Context growth (iters 523-537)**: 54k → 99k → 60k → 58k → 73k → 72k →
  79k → 97k tokens/turn. Average 74k, +18% growth trend. Driven by builder
  reading 18+ source files during orientation. Directly causes cost growth
  ($7.42 in iter 537 vs $5.35 avg).
- **Rework trend (iters 523-537)**: 55% → 38% → 28% → 44% → 57% → 63% →
  76% → 68%. Consumer-first editing (iter 536) partially effective. Remaining
  rework sources: lint (5.0× reruns), tests (5.0×), typecheck (3.0×).
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
| Multi-turn conversation | ✓ | **Not tested** |
| Error recovery in agent loop | ✓ | **Not tested** |
| Ambiguous instruction handling | ? | **Not tested** |
| Cross-session continuity | Partial | **Not tested** |

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
- **Rework intervention (iter 536)**: Consumer-first editing pattern. Verified
  in iter 538: rework dropped from 76% to 68%. Partial success — the pattern
  helped but didn't reach <60% target. Remaining sources: lint and test reruns.
- **Context intervention (iter 538)**: Restructured builder workflow to defer
  source file reads until after deciding what to build. **Verify in iter 540**:
  did iter 539's context/turn drop below 80k? Did cost drop below $6? If not,
  the directive may need stronger enforcement or a structural aid (e.g., auto-
  generated repo map file).

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
4. **Cross-iteration learning** — **ADDRESSED (iters 534, 536, 538)**:
   `BUILDER_LESSONS.md` implements Reflexion-style persistent knowledge. Now
   includes pre-flight health checks (534), cross-cutting change patterns (536),
   and context efficiency (538). Rework dropped 76% → 68% after iter 536.
   Next: verify context reduction in iter 539.
5. **GEPA-inspired prompt diversification** — Maintain a Pareto frontier of
   builder prompt variants that each excel on different task types (features vs
   depth vs quality). Select based on recent work patterns. High potential but
   requires infrastructure.
