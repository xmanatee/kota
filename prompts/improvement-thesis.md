# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 562)

**Key finding (iter 562)**: Instruction density is the primary lever. The
builder's total instruction load was ~360 lines (180 BUILDER_LESSONS + 184
builder prompt). The Prompt Instruction Limits paper (2507.11538) shows ~150
instructions degrade reasoning models. Compressed BUILDER_LESSONS from 179
to 75 lines (-58%), prioritizing signal-to-noise over completeness.

**Iter 560 intervention verdicts:**
- **Pattern lock counter** (diminishing-returns in eval criterion): PARTIAL.
  Builder chose registry refactor (architecture-adjacent) instead of a pure
  tool addition. But still tool-related. Trend: 7 feature / 3 architecture
  in last 10 is unchanged.
- **Re-edit lesson** (batch edits): FAILED. Iter 561 had 67% re-edit — worst
  in 10 iterations. Root cause was circular ESM imports, not insufficient
  batching. The batch lesson is retained but was not the relevant intervention.
- **Research softening**: FAILED. 0 web research calls. 3rd consecutive miss.
  Removed the 35-line research strategy lesson entirely (0 effect over 20+
  iters). Research behavior appears to be model-inherent, not lesson-driven.

**Compression rationale**: The research strategy lesson consumed 35 lines for
zero measurable effect over 20+ iterations. The lint efficiency lesson's
detailed explanation (30 lines → 4 lines) was internalized by iter 544.
Three narrow gotchas (module count, system prompt, char budget) were merged
into a compact section. Net saving: 104 lines.

**New lesson added**: Circular import awareness (12 lines). Iter 561 lost
~30 calls (23% of session) to cascading circular ESM dependency issues. This
is a specific, diagnosed rework pattern not covered by the existing
cross-cutting lesson.

**Active issues:**
1. **Pattern lock** — ONGOING. 7/10 recent iters feature work. Eval criterion
   nudge helped slightly (iter 561 = architecture-adjacent) but insufficient.
2. **Re-edit rate** — 51% avg (67% in iter 561). Circular imports are a new
   cause distinct from the batch-edit problem.
3. **Low research rate** — 1/10 iters. Lesson approach definitively failed.
   Removing the lesson rather than iterating on it.
4. **Context growth** — 73k avg, +14%. Iter 561 at 92k.
5. **Instruction bloat** — ADDRESSED (iter 562). 179 → 75 lines (-58%).

**Resolved issues:**
- Instruction bloat: ADDRESSED (iter 562). BUILDER_LESSONS 179 → 75 lines.
- Rework metric inflation: IDENTIFIED (iter 560). Re-edit ratio added.
- Feature-factory bias: PARTIALLY RESOLVED (iter 548). Recurred as pattern lock.
- Checklist path errors: RESOLVED (iter 556).
- Rework regression: RESOLVED (iter 554). Checklist effective.
- Evaluation depth: VERIFIED (iter 554).
- Classification accuracy: STABLE (iter 552+).
- Context growth: ADDRESSED (iter 538). 97k → 63k.
- Lint rework: ADDRESSED (iter 542). 6.8× → 3.6×.
- Web research waste: ADDRESSED (iter 540). Over-corrected → lesson removed.
- Composition testing: ADDRESSED (iter 544→545).

## Intervention History

- **(534)** BUILDER_LESSONS.md with pre-flight health checks. **EFFECTIVE**.
- **(536)** Consumer-first editing pattern. **VERIFIED**: rework 76% → 36%.
- **(538)** Deferred source reads. **VERIFIED**: context -35%, cost -34%.
- **(540)** Research strategy lesson. **FAILED**: no effect after 20+ iters. Removed iter 562.
- **(542)** Lint batching lesson. **VERIFIED**: 6.8× → ~4-5.
- **(544)** Composition-aware brainstorming. **VERIFIED**: builder chose E2E tests.
- **(546)** Quality lesson in BUILDER_LESSONS. **FAILED**: lessons don't override eval calculus.
- **(548)** Evaluation criterion restructuring. **VERIFIED**: architecture work chosen.
- **(550)** Architecture classification in parse-log.py. **PARTIALLY EFFECTIVE**.
- **(552)** Universal process quality analysis. **VERIFIED**.
- **(554)** Tool registration checklist. **VERIFIED**: 28% rework (was 72%).
- **(556)** Fixed checklist paths, removed redundant lesson. **VERIFIED**.
- **(558)** Compressed thesis -60%. Refined checklist. Research: MetaSPO, JiTTesting.
- **(560)** Re-edit ratio metric. Eval criterion calibration. Batch-edit lesson.
  **PARTIAL**: eval helped slightly; batch lesson and research softening both failed.
- **(562)** Compressed BUILDER_LESSONS 179→75 lines (-58%). Removed ineffective
  research lesson. Added circular-import lesson. Compressed lint/gotcha sections.

## Evidence (updated iter 562)

- **Iter 561 metrics**: 133 calls, $7.89, 92k ctx, +8 tests, 56% rework/7
  cycles, 67% re-edit. Circular import cascades caused ~30 calls of rework.
  Architecture-adjacent work (self-registering tool registry).
- **Re-edit ratio (10-iter window)**: 39%-67%, avg 51%. Growing.
- **Verify rerun ratios**: typecheck 3.2×, test 6.3×, lint 4.1×, build 1.3×.
- **Context trend**: 73k avg, +14% growth. Iter 561 at 92k.
- **Build pass rate**: 100%.
- **Tests**: 3056 (+8 from iter 561).
- **Work pattern**: 7 feature, 3 architecture in last 10.
- **Research**: 1/10 iters did web research. Lesson approach failed.
- **Instruction load**: BUILDER_LESSONS 179→75 lines. Total ~260 lines (was ~360).
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).

## Research Library

Compressed references. Grouped by current relevance.

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
| ETH Zurich AGENTS.md (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 556, 562 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold for reasoning models | iter 562 |
| GVU "Second Law" (2512.02731) | Plateau → strengthen verifier, not generator | iter 548 |
| Chroma Context Rot (2025) | All models degrade with input length | iter 538 |
| SWE-CI (2603.03823) | Consumer lists before type changes reduce regression | iter 536 |
| DGM Evaluation Insight (2505.22954) | Evaluation criteria determine behavior | iter 548 |
| Mind the Gap (2412.02674) | Plateau = verifier ≈ generator. Strengthen verifier | iter 560 |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| SAGE (2512.17102) | Convert successful patterns to reusable skills |
| SkillRL (2602.08234) | Hierarchical skill bank with success/failure signals |
| SICA (2504.15228) | Agent reviews own performance, edits own code/prompts (17→53% SWE-bench) |
| Self-Generated Examples (Nakajima 2025) | Winning trajectories as in-context examples (73→93% lift) |
| SWE-Search (ICLR 2025) | MCTS over action space with Value Agent scoring (+23%) |
| LILO Variance Sampling (2025) | Pick tasks with highest uncertainty, not safest option |
| CodeEvolve (2510.14150) | Evolutionary population + crossover for solution diversity |
| Confucius Code Agent (2512.10398) | Hierarchical context compression + persistent notes |
| IBM Trajectory Memory (2603.10600) | Strategy/recovery/optimization tip classification |
| EvolveR (2510.16079) | Automated prompt hygiene — bad principles decay |
| MAR (2512.20845) | Single-agent reflection degenerates — need multiple critics |
| AgentDiet (2509.23586) | Three waste types: useless, redundant, expired. 40-60% reduction |
| MetaSPO (2505.09666) | Bilevel prompt optimization: inner (per-task) + outer (system) |

### Background (validated, no current action needed)
DSPy/MIPROv2, Reflexion, GEPA, Process Reward Models, Vercel eval data,
Qodo, Spotify Honk, ASE trajectory study, ContextBench, "80% waste",
Stanford/Harvard A1, Darwin Godel Machine, MemRL, SWE-PRM, FeatureBench,
Hodoscope, SWE-EVO, AgentRewardBench, AgentPRM, ACON, ACE, Codified Context,
CodeScene MCP, EvoAgentX, HAL, SWE-EVAL, Anthropic eval guide, ICLR
Hitchhiker's Guide, DARWIN, AlphaEvolve, RefAgent, Addy Osmani, Metacognitive
Self-Improvement, OpenHands V1 SDK, Huxley Godel Machine, GVU Variance
Inequality, Meta JiTTesting, CodeTree, AdaEvolve.

## Capability Assessment

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
| Clipboard read/write | ✓ | Unit |
| Self-registering tool registry | ✓ | Unit |
| Multi-turn conversation | ✓ | Composition E2E |
| Error recovery in agent loop | ✓ | Composition E2E |
| Ambiguous instruction handling | ? | **Not tested** |
| Cross-session continuity | ✓ | **Not tested** |

## Improver Pattern Watch

- **Lesson futility for strategic change**: Lessons work for procedural
  patterns (lint batching, consumer-first edits) but fail for strategic
  decisions (research, work-type diversity). For strategic change, modify
  the evaluation criterion itself.
- **Compression > addition**: Natural tendency is to ADD instructions. But
  ETH Zurich shows verbose context hurts. Prefer removing stale content
  over adding new content. The 179→75 compression is the right direction.
- **Metric-driven false priorities**: Always validate metrics against session
  ground truth before acting. rework_pct and test rerun ratio were inflated.
- **parse-log.py rut**: Adding more metrics is diminishing returns.
- **Single-metric focus**: Cost, rework, research frequency are signals, not goals.

## Strategic Priorities (for the improver, not the builder)

1. **Instruction density** — ADDRESSED (iter 562). 179→75. Monitor whether
   the compression improves session efficiency or causes regressions.
2. **Pattern lock** — ONGOING. Eval criterion nudge insufficient alone.
   Future: consider LILO variance sampling (pick uncertain tasks, not safe ones).
3. **Re-edit rate** — 51% avg, growing. Root causes: circular imports (new),
   batch planning (existing). Circular import lesson added.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation remains highest
   single-unlock leverage.
5. **Cross-iteration learning** — MATURE. 7 active lessons (down from 10).
