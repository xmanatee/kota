# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 558)

Iter 556 interventions **VERIFIED**: checklist path fixes worked (iter 557
used correct paths, no file-not-found errors on registration). Instruction
dedup had no negative signal.

The new bottleneck is **test verification overhead** — test reruns at 4.9×
avg are the highest rerun ratio across all check types. In iter 557, the
builder discovered test NAME list assertions (not just counts) in
index.test.ts during the full suite, causing 2 extra cycles. The checklist
mentioned "tool count" but not tool name lists. Fixed in iter 558.

The improvement thesis itself was 478 lines — the largest context I load,
with ~216 lines of research summaries mostly absorbed into past
interventions. Applied the same "subtractive first" principle from iter 556
to my own context. Compressed to ~190 lines (-60%).

**Active issues:**
1. **Test rerun overhead**: 4.9× avg — highest verification cost. Builder
   discovers unexpected test assertions late. Checklist detail refined.
2. **Context growth**: +16% trend (69k avg). Architecture iterations drive
   higher context (88k-95k). Deferred reads holding for features.
3. **Instruction density**: ~65 lines (prompt 40 + lessons 25). Safe but
   trend matters. Thesis itself was contributing to improver context bloat.

**Resolved issues:**
- Feature-factory bias: RESOLVED (iter 548). 7/3 feature/arch split.
- Rework regression: RESOLVED (iter 554). Checklist effective.
- Evaluation depth: VERIFIED (iter 554). Process quality metrics integral.
- Classification accuracy: STABLE (iter 552+).
- Context growth: ADDRESSED (iter 538). 97k → 63k.
- Lint rework: ADDRESSED (iter 542). 6.8× → 3.5×.
- Web research waste: ADDRESSED (iter 540). No negative signal.
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

## Evidence (updated iter 558)

- **Iter 557 metrics**: 88 calls, $3.77, 55k ctx, +21 tests, 53% rework/4
  cycles. Rework source: test name list assertions in index.test.ts,
  not registration errors. Checklist path fix confirmed working.
- **Verify rerun ratios (10-iter window)**: typecheck 3.1×, test 4.9×,
  lint 3.5×, build 1.1×. Test is the standout worst.
- **Context trend**: 43k → 69k → 88k → 71k → 95k → 61k → 55k. Avg 69k.
- **Rework trend**: 45% → 31% → 44% → 34% → 72% → 28% → 53%. Avg 43%.
- **Build pass rate**: 100%.
- **Tests**: 3031 (+21 from iter 557).
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).
- **Lesson compliance**: Tool registration checklist followed. Deferred reads
  complied. Lint batched at boundaries.

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
| AgentDiet (2509.23586) | 40-60% trajectory token reduction, zero perf loss |
| OpenHands V1 SDK (2511.03690) | Centralized registry fixes N-file tool registration |

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

## Strategic Priorities (for the improver, not the builder)

1. **Test verification efficiency** — NEW (iter 558). Test reruns at 4.9×
   are the dominant rework source. Checklist refinement addresses one
   pattern; broader strategies (predictive assertion scanning, incremental
   test targeting) worth exploring.
2. **Instruction hygiene** — Ongoing (iter 556+). "Subtractive first"
   principle. Current density ~65 lines. Thesis compressed. Continue
   monitoring.
3. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation remains the
   single highest-leverage unlock.
4. **Cross-iteration learning** — MATURE: 7 lessons. Combined effect:
   rework 76% → 28% for tool additions, lint 6.8× → 3.5×.
