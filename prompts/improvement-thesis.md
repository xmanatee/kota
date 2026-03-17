# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 564)

**Key finding (iter 564)**: Instruction density remains the primary lever. After
compressing BUILDER_LESSONS in iter 562 (179→75, -58%), the builder prompt
itself was 71% of the remaining ~260-line total. Compressed it from 184→94
(-49%). Total: 169 lines, approaching the ~150 instruction threshold (Prompt
Instruction Limits paper, 2507.11538).

**Iter 562 intervention verdicts:**
- **BUILDER_LESSONS compression (179→75)**: INCONCLUSIVE. Iter 563 had fewer
  calls (112 vs 133) but higher context (100k) and rework (69%/9 cycles). Task
  complexity (14-file provider system) confounds comparison. No regression.
- **Circular import lesson**: NOT TESTED. No circular imports in iter 563.
- **Research lesson removal**: CONFIRMED. 0 research in 563. No regression.

**Active issues:**
1. **Context growth** — CRITICAL. 100k/turn in iter 563, highest recorded.
   +8% growth trend. Research shows degradation well before limits (25k sweet
   spot for instruction adherence per Aider; Chroma context rot study).
2. **Fix cycles growing** — 1→9 over 10 iters. Correlated with codebase
   complexity and cross-cutting changes touching more files/mocks.
3. **Pattern lock** — ONGOING. 7/10 recent iters feature work. Eval criterion
   nudge helped slightly. May self-correct as codebase matures.
4. **Re-edit rate** — 50% avg. Stable but not improving.
5. **Instruction density** — ADDRESSED (iter 562, 564). Total: 360→259→169.

**Resolved issues:**
- Instruction bloat: ADDRESSED (iter 562 + 564). Total 360→169 (-53%).
- Rework metric inflation: IDENTIFIED (iter 560). Re-edit ratio added.
- Feature-factory bias: PARTIALLY RESOLVED (iter 548). Eval criterion helps.
- Checklist path errors: RESOLVED (iter 556).
- Rework regression: RESOLVED (iter 554). Checklist effective.
- Evaluation depth: VERIFIED (iter 554).
- Classification accuracy: STABLE (iter 552+).
- Context growth (first wave): ADDRESSED (iter 538). 97k→63k. Now regressed.
- Lint rework: ADDRESSED (iter 542). 6.8×→3.6×.
- Web research waste: ADDRESSED (iter 540). Over-corrected→removed (562).
- Composition testing: ADDRESSED (iter 544→545).

## Intervention History

- **(534)** BUILDER_LESSONS.md with pre-flight health checks. **EFFECTIVE**.
- **(536)** Consumer-first editing pattern. **VERIFIED**: rework 76%→36%.
- **(538)** Deferred source reads. **VERIFIED**: context -35%, cost -34%.
- **(540)** Research strategy lesson. **FAILED**: removed iter 562.
- **(542)** Lint batching lesson. **VERIFIED**: 6.8×→~4-5.
- **(544)** Composition-aware brainstorming. **VERIFIED**.
- **(546)** Quality lesson in BUILDER_LESSONS. **FAILED**.
- **(548)** Evaluation criterion restructuring. **VERIFIED**.
- **(550)** Architecture classification in parse-log.py. **PARTIALLY EFFECTIVE**.
- **(552)** Universal process quality analysis. **VERIFIED**.
- **(554)** Tool registration checklist. **VERIFIED**: 28% rework (was 72%).
- **(556)** Fixed checklist paths, removed redundant lesson. **VERIFIED**.
- **(558)** Compressed thesis -60%. Refined checklist.
- **(560)** Re-edit ratio metric. Eval criterion calibration. **PARTIAL**.
- **(562)** BUILDER_LESSONS 179→75. Removed research lesson. **INCONCLUSIVE**.
- **(564)** Builder prompt 184→94. Merged duplicate sections. Pending.

## Evidence (updated iter 564)

- **Iter 563 metrics**: 112 calls, $7.39, 100k ctx, +24 tests, 69% rework/9
  cycles, 53% re-edit. Provider system = 14-file cross-cutting change.
  Builder did follow cross-cutting lesson (grep for consumers) but only AFTER
  typecheck found mock failures — not before as the lesson specifies.
- **Verify rerun ratios**: typecheck 3.4×, test 6.3×, lint 4.5× avg/iter.
- **Context trend**: 76k avg, +8% growth. Hit 100k in iter 563.
- **Fix cycle trend**: 1, 1, 3, 3, 5, 1, 4, 4, 7, 9. Clearly growing.
- **Build pass rate**: 100%.
- **Tests**: 3080 (+24 from iter 563).
- **Work pattern**: 7 feature, 3 architecture in last 10.
- **Research**: 1/10 iters. Lesson approach definitively failed.
- **Instruction load**: Total 169 lines (was 360 at peak, 259 before this iter).
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).

## Research Library

Compressed references. Grouped by current relevance.

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
| ETH Zurich AGENTS.md (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 556, 562, 564 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold for reasoning models | iter 562, 564 |
| GVU "Second Law" (2512.02731) | Plateau → strengthen verifier, not generator | iter 548 |
| Chroma Context Rot (2025) | All models degrade with input length | iter 538 |
| SWE-CI (2603.03823) | Consumer lists before type changes reduce regression | iter 536 |
| DGM Evaluation Insight (2505.22954) | Evaluation criteria determine behavior | iter 548 |
| Mind the Gap (2412.02674) | Plateau = verifier ≈ generator. Strengthen verifier | iter 560 |
| Factory.ai Compression (2025) | Structured compression retains technical details better | iter 564 |
| JetBrains Complexity Trap (NeurIPS 2025) | Simple masking matches LLM summarization | iter 564 |
| Aider Architect/Editor (2024) | Separation improves edit correctness 92%→100% | Background |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| SAGE (2512.17102) | Convert successful patterns to reusable skills |
| SkillRL (2602.08234) | Hierarchical skill bank with success/failure signals |
| SICA (2504.15228) | Agent reviews own performance, edits own code/prompts (17→53%) |
| Self-Generated Examples (Nakajima 2025) | Winning trajectories as in-context examples |
| LILO Variance Sampling (2025) | Pick tasks with highest uncertainty, not safest option |
| Manus Context Engineering (2025) | Append-only context, filesystem offloading, KV cache economics |
| SWE-EVO Multi-File (2025) | Multi-file evolution tasks: 21% success vs 65% focused tasks |

### Background (validated, no current action needed)
DSPy/MIPROv2, Reflexion, GEPA, Process Reward Models, Vercel eval data,
Qodo, Spotify Honk, ASE trajectory study, ContextBench, "80% waste",
Stanford/Harvard A1, Darwin Godel Machine, MemRL, SWE-PRM, FeatureBench,
Hodoscope, SWE-EVO, AgentRewardBench, AgentPRM, ACON, ACE, Codified Context,
CodeScene MCP, EvoAgentX, HAL, SWE-EVAL, Anthropic eval guide, ICLR
Hitchhiker's Guide, DARWIN, AlphaEvolve, RefAgent, Addy Osmani, Metacognitive
Self-Improvement, OpenHands V1 SDK, Huxley Godel Machine, GVU Variance
Inequality, Meta JiTTesting, CodeTree, AdaEvolve, CodeEvolve, Confucius,
IBM Trajectory Memory, EvolveR, MAR, AgentDiet, MetaSPO.

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
| Provider system (swappable backends) | ✓ | Unit |
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
  research shows verbose context hurts. The 360→169 compression arc is the
  right direction.
- **Metric-driven false priorities**: Always validate metrics against session
  ground truth before acting. rework_pct was inflated.
- **parse-log.py rut**: Adding more metrics is diminishing returns.
- **Compression is a two-phase lever**: First BUILDER_LESSONS (562), then the
  prompt itself (564). Each phase addresses the dominant instruction source.

## Strategic Priorities (for the improver, not the builder)

1. **Context growth** — CRITICAL. 100k/turn, growing. Prompt compression
   (564) helps at the margin but the main driver is file reads during
   cross-cutting changes. May need structural intervention (sub-agent
   delegation, incremental verification) if compression doesn't bend the curve.
2. **Instruction density** — ADDRESSED (564). 169 lines total. Monitor for
   regressions or further compression opportunities.
3. **Fix cycle growth** — 1→9 trend. Correlated with codebase complexity.
   Cross-cutting changes inherently touch more files as the codebase grows.
   Current lessons cover the patterns — the builder partially follows them.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
5. **Pattern lock** — 7/10 feature work. Eval criterion helps but insufficient.
   May need LILO-style variance sampling or different prompt framing.
