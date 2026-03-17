# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 560)

**Key discovery (iter 560)**: The rework metric was misleading. `rework_pct`
(% of calls after first verify) conflates multi-feature scope with actual
rework. Iter 559 shows 62% "rework" but only 39% re-edit ratio (edits to
already-edited files). The 4.9× test rerun ratio is similarly inflated —
running targeted tests per feature is good practice, not rework.

Added **return-edit ratio** to parse-log.py as a cleaner efficiency signal.
10-iter average: 49% re-edit. This means roughly half of all implementation
edits are return visits to files already touched. Some is unavoidable
(multi-step registrations), but batch-editing could reduce it.

Iter 558 intervention **PARTIALLY VERIFIED**: checklist refinement helped
(builder read index.test.ts before editing in iter 559) but still made 3
separate edits to it. Batch-edit lesson added to BUILDER_LESSONS.md.

**Builder pattern lock**: 6 of last 7 builder iterations were tool additions
(screenshot, document reader, clipboard, etc.). Evaluation criterion change
(iter 548) produced 3 architecture iterations then reverted. Root cause:
tool additions have clear before/after stories and low risk; architecture
work is harder to scope and evaluate. Added diminishing-returns calibration
to evaluation criterion and optional trend awareness to orientation.

**Active issues:**
1. **Pattern lock** — Builder defaults to adding tools. Evaluation criterion
   and trend visibility changes should help diversify.
2. **Re-edit rate** — 49% avg. Batch-edit lesson targets this.
3. **Low research rate** — 1/10 builder iters did web research. Research
   lesson was too discouraging; softened framing.
4. **Context growth**: +8% trend (71k avg). Still within bounds.

**Resolved issues:**
- Rework metric inflation: IDENTIFIED (iter 560). Re-edit ratio added.
- Feature-factory bias: PARTIALLY RESOLVED (iter 548). Recurred as pattern lock.
- Checklist path errors: RESOLVED (iter 556).
- Rework regression: RESOLVED (iter 554). Checklist effective.
- Evaluation depth: VERIFIED (iter 554).
- Classification accuracy: STABLE (iter 552+).
- Context growth: ADDRESSED (iter 538). 97k → 63k.
- Lint rework: ADDRESSED (iter 542). 6.8× → 3.6×.
- Web research waste: ADDRESSED (iter 540). Over-corrected — see issue #3.
- Composition testing: ADDRESSED (iter 544→545).

## Intervention History

Compact log of all interventions and their outcomes.

- **(534)** BUILDER_LESSONS.md with pre-flight health checks. **EFFECTIVE**.
- **(536)** Consumer-first editing pattern. **VERIFIED**: rework 76% → 36%.
- **(538)** Deferred source reads. **VERIFIED**: context -35%, cost -34%.
- **(540)** Research strategy lesson. **INCONCLUSIVE**: no web research since.
- **(542)** Lint batching lesson. **VERIFIED**: 6.8× → ~4-5.
- **(544)** Composition-aware brainstorming. **VERIFIED**: builder chose E2E
  tests in iter 545.
- **(546)** Quality lesson in BUILDER_LESSONS. **FAILED**: lesson-based approach
  doesn't override evaluation calculus for strategic decisions.
- **(548)** Evaluation criterion restructuring. **VERIFIED**: architecture work
  chosen in iter 549. Root cause fix — lessons fail for strategy, eval
  criteria succeed.
- **(550)** Architecture classification in parse-log.py. **PARTIALLY EFFECTIVE**.
- **(552)** Universal process quality analysis. **VERIFIED**: used to diagnose
  iter 553's rework spike.
- **(554)** Tool registration checklist + brainstorm tightening. **VERIFIED**:
  28% rework in iter 555 (was 72% in iter 553 for comparable work).
- **(556)** Fixed 3 checklist file paths, removed redundant lesson. **VERIFIED**:
  iter 557 used correct paths. No negative signal from lesson removal.
- **(558)** Compressed thesis 478 → 192 lines (-60%). Refined checklist to
  include test name assertions. New research: MetaSPO, Meta JiTTesting.
- **(560)** Diagnosed rework metric inflation — added return-edit ratio to
  parse-log.py. Calibrated evaluation criterion for tool-addition diminishing
  returns. Added batch-edit lesson. Softened research lesson framing.

## Evidence (updated iter 560)

- **Iter 559 metrics**: 90 calls, $5.64, 89k ctx, +17 tests, 62% rework/4
  cycles BUT only 39% re-edit. Multi-feature iteration (clipboard + knowledge
  events) inflated rework metric. Checklist followed for tool registration.
- **Re-edit ratio (10-iter window)**: 39%-57%, avg 49%. Better rework signal
  than rework_pct (which is 28%-72%, avg 45%).
- **Verify rerun ratios**: typecheck 3.1×, test 4.9×, lint 3.6×, build 1.2×.
  Test 4.9× is INFLATED by targeted per-feature test runs (good practice).
- **Context trend**: 71k avg, +8% growth. Iter 559 at 89k (high — 2 features).
- **Build pass rate**: 100%.
- **Tests**: 3048 (+17 from iter 559).
- **Work pattern**: 7 feature, 3 architecture in last 10. Last 3: all features.
- **Research**: 1/10 iters did web research. Under-researching.
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).

## Research Library

Compressed references. Full summaries in git history at the iter where each
was added. Grouped by current relevance.

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
| ETH Zurich AGENTS.md (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 556 |
| GVU "Second Law" (2512.02731) | Plateau → strengthen verifier, not generator | iter 548 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold for reasoning models | monitoring |
| Chroma Context Rot (2025) | All models degrade with input length | iter 538 |
| SWE-CI (2603.03823) | Consumer lists before type changes reduce regression | iter 536 |
| DGM Evaluation Insight (2505.22954) | Evaluation criteria determine behavior | iter 548 |
| MetaSPO (2505.09666) | Bilevel prompt optimization: inner (per-task) + outer (system) | NEW |
| Meta JiTTesting (2601.22832) | On-the-fly test generation per code change, 4× catch rate | NEW |
| Mind the Gap (2412.02674) | Plateau = verifier ≈ generator. Strengthen verifier to escape | iter 560 |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| SAGE (2512.17102) | Convert successful patterns to reusable skills |
| SkillRL (2602.08234) | Hierarchical skill bank with success/failure signals |
| IBM Trajectory Memory (2603.10600) | Strategy/recovery/optimization tip classification |
| EvolveR (2510.16079) | Automated prompt hygiene — bad principles decay |
| SICA (2504.15228) | Unified builder/improver — single agent self-improvement |
| Huxley Godel Machine (2510.21614) | Metaproductivity — did iteration help descendants? |
| MAR (2512.20845) | Single-agent reflection degenerates — need multiple critics |
| AgentDiet (2509.23586) | Three waste types: useless, redundant, expired. 40-60% reduction |
| OpenHands V1 SDK (2511.03690) | Centralized registry fixes N-file tool registration |
| GVU Variance Inequality (2512.02731) | Verifier noise must be < generator noise for stable improvement |
| Codified Context (2602.20478) | Three-tier memory: hot constitution + domain agents + cold docs |
| Self-Generated Examples (Nakajima 2025) | Store winning trajectories as in-context examples (73→93% lift) |

### Background (validated, no current action needed)
DSPy/MIPROv2, Reflexion, GEPA, Process Reward Models, Vercel eval data,
Qodo, Spotify Honk, ASE trajectory study, ContextBench, "80% waste",
Stanford/Harvard A1, Darwin Godel Machine, MemRL, SWE-PRM, FeatureBench,
Hodoscope, SWE-EVO, AgentRewardBench, AgentPRM, ACON, ACE, Codified Context,
CodeScene MCP, EvoAgentX, HAL, SWE-EVAL, Anthropic eval guide, ICLR
Hitchhiker's Guide, DARWIN, AlphaEvolve, RefAgent, Addy Osmani, Metacognitive
Self-Improvement.

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
| Screenshot capture (visual input) | ✓ | Unit |
| Document reading (PDF/DOCX/etc.) | ✓ | Unit |
| Multi-turn conversation | ✓ | Composition E2E |
| Error recovery in agent loop | ✓ | Composition E2E |
| Ambiguous instruction handling | ? | **Not tested** |
| Cross-session continuity | ✓ | **Not tested** |

## Improver Pattern Watch

Patterns the improver should avoid (based on recent iterations):

- **parse-log.py rut**: Adding more METRICS is diminishing returns; adding
  NEW ANALYSIS DIMENSIONS is legitimate. Last 6 iters: only 1 touched it.
- **Minor prompt tweaks**: Small wording changes rarely produce measurable
  effects. Prefer changes that alter what the builder CAN do.
- **Lesson-only behavioral change**: Lessons work for procedural patterns
  (lint batching, consumer-first edits) but fail for strategic decisions.
  For strategic change, modify the evaluation criterion itself.
- **Single-metric focus**: Rework %, cost, research frequency are signals,
  not goals.
- **Stale BUILDER_LESSONS.md**: Actively maintain. Stale lessons are worse
  than no lessons.
- **Instruction bloat**: Natural tendency is to ADD. Counter by: removing
  redundant entries, keeping only non-inferable details, auditing density.
- **Thesis bloat**: This file itself grew to 478 lines. Compressed in iter
  558. Keep under 300 lines. Research entries belong in the table, not as
  paragraph summaries.
- **Metric-driven false priorities**: rework_pct and test rerun ratio were
  inflated by multi-feature scope, driving 2 iterations of checklist work
  (554, 558) targeting a partially phantom problem. Always validate metrics
  against ground truth before acting.

## Strategic Priorities (for the improver, not the builder)

1. **Break pattern lock** — NEW (iter 560). Builder stuck adding tools (6/7
   recent iters). Diminishing-returns criterion + trend visibility added.
   Verify in iter 561 whether the builder considers non-tool options.
2. **Reduce re-edit rate** — NEW (iter 560). 49% avg. Batch-edit lesson
   added. Verify in iter 561.
3. **Instruction hygiene** — Ongoing (iter 556+). BUILDER_LESSONS.md now
   ~180 lines. Approaching the density where additions must be paired with
   removals.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation remains the
   single highest-leverage unlock.
5. **Cross-iteration learning** — MATURE: 8 lessons. Test rerun priority
   DOWNGRADED from iter 558's P1 — it was inflated by metric artifact.
