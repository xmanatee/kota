# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 572)

**Key finding (iter 572)**: Work-type classification was broken — 4 recent
architecture iterations (561, 563, 569, 571) were misclassified as "feature",
producing a false "5/5 feature dominant" signal. Fix: expanded architecture
keywords in parse-log.py + made title loader read archive. Trend now shows
accurate "3 architecture, 2 feature" for last 5. System health is excellent:
54 calls (lowest ever), $2.62, 0-1 fix cycles, +14 tests.

**Iter 570 intervention verdicts:**
- **CHANGELOG verbosity cap (25 lines)**: EFFECTIVE. Iter 571 entry was 26
  lines (vs ~70 avg before). ~63% reduction. No builder read errors.
- **`tail -80` for orient reads**: EFFECTIVE. 0 CHANGELOG read errors in iter
  571 (was 1-2/iter).
- **Archive iters 541-563**: EFFECTIVE. Active CHANGELOG stable at ~400 lines.

**Active issues:**
1. **Work-type classification** — FIXED this iter. 4 misclassified iters.
   Added 9 architecture keywords + archive title loading.
2. **Context growth** — GOOD. 55k/turn in iter 571 (slight uptick from 48k
   best-ever in 569, but well below 70-100k range). 71k avg, shrinking -36%.
3. **Test rerun** — 5.4× avg (improved from 8.0×). Incremental testing
   workflow, not waste.
4. **Instruction density** — STABLE at ~97 lines. Well under ~150 threshold.
5. **Web research** — 1/5 builder iters used research. Not blocking execution
   quality but may limit novel pattern discovery for composition work.

**Resolved issues:**
- Work-type classification: FIXED (iter 572). False "5/5 feature" signal.
- CHANGELOG growth: RESOLVED (iter 568+570+572). Archival + verbosity cap + archive title loading.
- Pattern lock: RESOLVED (iter 568→569). Eval criterion + trend analysis worked.
- Instruction bloat: ADDRESSED (iter 562 + 564). Total 360→169 (-53%).
- Rework metric inflation: IDENTIFIED (iter 560). Re-edit ratio added.
- Feature-factory bias: RESOLVED (iter 548→568). Eval criterion effective.
- Checklist path errors: RESOLVED (iter 556).
- Rework regression: RESOLVED (iter 554). Checklist effective.
- Lint rework: ADDRESSED (iter 542). 6.8×→3.6×.
- System-prompt checklist: PARTIALLY EFFECTIVE (iter 566). 4→2 fix cycles.

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
- **(564)** Builder prompt 184→94. Merged duplicate sections. **EFFECTIVE**.
- **(566)** System-prompt test added to tool checklist. **PARTIALLY EFFECTIVE**.
- **(568)** CHANGELOG archive (23k→2k lines). Sharpened eval criterion. Trend
  analysis non-optional. **EFFECTIVE** (pattern lock broken in iter 569).
- **(570)** CHANGELOG verbosity cap (entries ≤25 lines), `tail -80` for orient
  reads, archived iters 541-563. **EFFECTIVE** (iter 571: 26-line entry, 0 read errors).
- **(572)** Work-type classification fix: +9 architecture keywords, archive
  title loading. False "5/5 feature" → accurate "3 arch, 2 feature".

## Evidence (updated iter 572)

- **Iter 571 metrics**: 54 calls (lowest ever), $2.62, 55k ctx, +14 tests,
  1 fix cycle, 75% re-edit. Step-based event handlers (architecture). Only 2
  files edited (module-factory.ts + test). 0 CHANGELOG read errors. Builder
  operated efficiently with focused single-file changes.
- **Iter 569 metrics**: 61 calls, $2.53, 48k ctx, +8 tests, 0 fix cycles,
  25% re-edit. Architecture work (ctx.callTool). Best cost iteration.
- **5-iter trend**: calls 112→86→64→61→54 (↓52%). Cost $7.39→$2.62 (↓65%).
  Context 100k→55k (↓45%). Fix cycles 9→3→4→2→1 (excellent decline).
- **Verify rerun ratios**: typecheck 2.4×, test 5.4×, lint 4.2× avg/iter.
- **Context trend**: 71k avg, shrinking -36%.
- **Build pass rate**: 100%.
- **Tests**: 3173 (+14 from iter 571).
- **Work pattern**: 3/5 architecture, 2/5 feature (corrected from false 5/5).
- **Research**: 1/5 iters. Consistent skip pattern.
- **Instruction load**: ~97 lines builder prompt. Stable.
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).
- **Re-edit metric noise**: 75% re-edit with 1 fix cycle (iter 571) = incremental
  building, not rework. Metric doesn't distinguish. Fix cycles are the reliable
  rework signal.

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
| ReVeal (2506.11442) | Pre-flight self-critique before running checks reduces rework |
| OpenEvolve/AlphaEvolve (2025) | Evolutionary prompt optimization; meta-prompt evolution alongside code |
| Self-Generated Examples (Nakajima 2025) | Winning trajectories as in-context examples; 73→93% on ALFWorld |
| LILO Variance Sampling (2025) | Pick tasks with highest uncertainty, not safest option |
| Factory.ai Linters as Arch Specs (2025) | Encode conventions as lint rules for instant deterministic feedback |
| EvolveR (arXiv 2510.16079) | Experience distillation into guiding/cautionary principles |
| TRACE (2602.21230, WWW 2026) | Scaffolded capability assessment: measure min guidance needed, not just pass/fail |
| EvoAgentX (EMNLP 2025) | TextGrad/AFlow/MIPRO for automated prompt+workflow optimization; +7-20% |
| Anthropic Evals Guide (Jan 2026) | 20-50 tasks from real failures; grade outcomes not trajectories |
| Comprehensive Self-Evolving Survey (2508.07407) | Unified framework for self-evolving agent feedback loops |

### Background (validated, no current action needed)
DSPy/MIPROv2, Reflexion, GEPA, Process Reward Models, Vercel eval data,
Qodo, Spotify Honk, ASE trajectory study, ContextBench, "80% waste",
Stanford/Harvard A1, Darwin Godel Machine, MemRL, SWE-PRM, FeatureBench,
Hodoscope, SWE-EVO, AgentRewardBench, AgentPRM, ACON, ACE, Codified Context,
CodeScene MCP, HAL, SWE-EVAL, ICLR Hitchhiker's Guide, DARWIN, RefAgent,
Addy Osmani, Metacognitive Self-Improvement, OpenHands V1 SDK, Huxley Godel
Machine, GVU Variance, AgentRx, ADAS, Anthropic Context Engineering,
Anthropic Effective Harnesses, AgentEvolver, MAE, Self-Play (2512.02731)
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
| Computer use (mouse/keyboard control) | ✓ | Unit |
| SQLite database queries | ✓ | Unit |
| Module tool invocation (ctx.callTool) | ✓ | Unit |
| Declarative step-based event handlers | ✓ | Unit |
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
  ground truth before acting. rework_pct was inflated. re-edit% is noisy
  (75% + 0-1 fix cycles = normal incremental building, not rework).
- **parse-log.py rut**: Adding more metrics is diminishing returns. But
  fixing classification accuracy in EXISTING metrics (this iter) is high-value.
- **Classification accuracy > new metrics**: The "5/5 feature" false signal
  persisted for multiple iterations because architecture keywords weren't
  comprehensive enough. Maintaining classification quality is ongoing work.
- **Compression improves execution quality, not just cost**: Iter 565 showed
  improvements across ALL metrics after prompt compression. Still holding.
- **Structured artifacts beat summarization**: Keep recent structured state,
  archive the rest. CHANGELOG archive working as designed.

## Strategic Priorities (for the improver, not the builder)

1. **Signal accuracy** — ONGOING. Classification keywords need maintenance as
   the builder explores new architecture patterns. Check after each iter.
2. **Context growth** — GOOD. 55k/turn, 71k avg, shrinking -36%. Stable.
3. **Test rerun** — 5.4× avg (improved). Incremental testing, not waste.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
5. **Research encouragement** — 1/5 iters used research. Lessons failed
   (iter 540). Could revisit via eval criterion (e.g., "for novel composition
   patterns, check how LangGraph/CrewAI/Temporal handle this").
