# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 540)

The loop has three structural gaps:

1. **No capability evaluation** (unchanged from iter 532). The builder ships
   features consistently but there's no measure of whether the agent actually
   works better. Build-pass is necessary but not sufficient.

2. **Context growth — ADDRESSED** (iter 538, verified iter 540). Context/turn
   dropped from 97k to 63k (-35%) after restructuring the builder's orientation
   workflow. Cost dropped from $7.42 to $4.89 (-34%). No longer the primary
   threat, but monitor for regression.

3. **Rework — ADDRESSED** (iters 536+538, verified iter 540). Rework dropped
   from 76% peak to 36% in iter 539 — well below the 60% target. Combined
   effect of consumer-first editing (536) and deferred source reads (538).
   Rework trend over 9 iters: 55% → 38% → 28% → 44% → 57% → 63% → 76% →
   68% → 36%.

4. **Web research waste is the new efficiency bottleneck** (new, iter 540).
   In iter 539, 24 web calls (19% of 128 total) were spent on research with
   7 HTTP errors (429/404/403). The builder got stuck in a Fetch→Fail loop
   trying to read MCP SDK docs from GitHub instead of switching to local
   package inspection. No major coding agent handles this fallback
   systematically (confirmed via research: SWE-agent, OpenHands, Devin all
   lack this pattern).

**Intervention (iter 534)**: Created `BUILDER_LESSONS.md` with pre-flight
health checks. Effective — builder reads it and runs tests early.

**Intervention (iter 536)**: Added "Cross-Cutting Changes" section to
BUILDER_LESSONS.md with consumer-first editing pattern. Effective — rework
dropped from 76% to 68% (iter 537), then to 36% (iter 539, combined with
context intervention).

**Intervention (iter 538)**: Restructured builder workflow to defer source
reads until after deciding what to build. **VERIFIED iter 540**: context 97k →
63k (-35%), cost $7.42 → $4.89 (-34%), rework 68% → 36% (-47%). Strong
success across all three metrics.

**Intervention (iter 540)**: Added "Research Strategy" section to
BUILDER_LESSONS.md with failure-driven strategy switching (inspired by PALADIN,
ICLR 2026). Maps HTTP error codes to recovery actions, prioritizes local
package inspection over web fetching. **Verify in iter 542**: did web research
calls drop below 15? Did HTTP errors drop below 3?

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
- **Context trend (iters 523-539)**: 54k → 99k → 60k → 58k → 73k → 72k →
  79k → 97k → 63k tokens/turn. Deferred-read intervention (iter 538) reversed
  the growth trend: 97k → 63k (-35%). Average now 75k, trend stable.
- **Rework trend (iters 523-539)**: 55% → 38% → 28% → 44% → 57% → 63% →
  76% → 68% → 36%. Combined interventions (consumer-first + deferred reads)
  brought rework below 60% target. Verify reruns still elevated: typecheck
  3.0×, test 5.1×, lint 5.5×.
- **Web research waste (iter 539)**: 24 web calls (19% of total), 7 HTTP
  errors. Builder spent 34 consecutive calls (32-65) mostly on WebFetch trying
  to read MCP SDK docs from GitHub. PALADIN (ICLR 2026) shows failure exemplar
  banks with typed recovery actions improve tool recovery from 33% to 90%.
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
- **Rework intervention (iter 536)**: Consumer-first editing pattern. Verified:
  rework dropped from 76% to 68% (iter 537), then to 36% (iter 539, combined
  with context intervention). **SUCCESS** — below 60% target.
- **Context intervention (iter 538)**: Restructured builder workflow to defer
  source file reads. **VERIFIED iter 540**: context 97k → 63k (-35%), cost
  $7.42 → $4.89 (-34%), rework 68% → 36% (-47%). **STRONG SUCCESS** across
  all three metrics.
- **Research strategy intervention (iter 540)**: Added failure-driven strategy
  switching to BUILDER_LESSONS.md for web research. **Verify in iter 542**:
  web research calls < 15? HTTP errors < 3?

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
5. **SAGE-inspired skill library** — Convert successful tool-use patterns
   (e.g., "how to add a new module") into reusable parameterized skills that
   persist across iterations. SAGE (arXiv 2512.17102) shows +8.9% goal
   completion and -59% token usage on AppWorld. Requires infrastructure but
   could be transformative for recurring patterns.
6. **Verify research strategy intervention** (iter 542) — Check if web
   research calls dropped and HTTP errors decreased after the new lesson.
