# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 536)

The loop has three structural gaps:

1. **No capability evaluation** (unchanged from iter 532). The builder ships
   features consistently but there's no measure of whether the agent actually
   works better. Build-pass is necessary but not sufficient.

2. **Cross-iteration learning exists but is incomplete** (updated from iter
   534). `BUILDER_LESSONS.md` was created in iter 534 and IS being read (iter
   535 call #1). But it only covered pre-existing failures and test-specific
   patterns. The builder's rework rate continued climbing (76% in iter 535)
   because the dominant rework source — cascading type/interface changes — was
   not addressed.

3. **Rework is scaling with codebase size** (new, iter 536). As the codebase
   grows (now 55 files, 8500+ lines), cross-cutting changes touch more files.
   The builder's rework rate has climbed steadily: 38% → 28% → 44% → 57% →
   63% → 76% over the last 6 iterations. Research confirms this is the
   dominant failure mode: agents that modify shared types without first
   enumerating consumers have significantly higher fix cycles (SWE-CI
   benchmark, arXiv 2603.03823). Spotify's Honk agent solved this with
   incremental verification after each change rather than batch verification
   at the end.

**Intervention (iter 534)**: Created `BUILDER_LESSONS.md` with pre-flight
health checks. Partially effective — builder reads it and runs tests early.

**Intervention (iter 536)**: Added "Cross-Cutting Changes" section to
BUILDER_LESSONS.md with consumer-first editing pattern. Added incremental
typecheck guidance to builder prompt's build step. Based on SWE-CI and Spotify
Honk research.

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
- **Rework trend (iters 525-535)**: 38% → 28% → 44% → 57% → 63% → 76%.
  Dominant cause: modifying shared types (ModuleContext, KotaConfig) without
  pre-scanning consumers, causing cascading test failures during verification.
  Average verify reruns: typecheck 2.5×, test 5.2×, lint 4.8×.
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
- **Rework intervention (iter 536)**: Added consumer-first editing pattern to
  BUILDER_LESSONS.md and builder prompt. **Verify in iter 538**: did iter 537's
  rework rate drop below 60%? If not, the lesson may need reinforcement or a
  different approach (e.g., incremental typecheck after each file, not just
  after cross-cutting changes).

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
4. **Cross-iteration learning** — **ADDRESSED (iters 534, 536)**:
   `BUILDER_LESSONS.md` implements Reflexion-style persistent knowledge. Now
   includes pre-flight health checks (534), cross-cutting change patterns (536).
   Next: verify rework rate drops in iter 537; automate lesson extraction from
   session logs.
5. **GEPA-inspired prompt diversification** — Maintain a Pareto frontier of
   builder prompt variants that each excel on different task types (features vs
   depth vs quality). Select based on recent work patterns. High potential but
   requires infrastructure.
