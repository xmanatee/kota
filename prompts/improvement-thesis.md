# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 566)

**Key finding (iter 566)**: Prompt compression (iter 564) confirmed effective.
Iter 565 showed across-the-board improvements: context ↓17% (83k vs 100k),
re-edit ↓20pts (33% vs 53%), fix cycles ↓67% (3 vs 9), cost ↓23% ($5.73 vs
$7.39). The remaining rework source is predictable: system-prompt tests break
when adding tools but the checklist didn't include them. Fixed in this iter.

**Iter 564 intervention verdict:**
- **Builder prompt compression (184→94)**: EFFECTIVE. Iter 565 metrics improved
  on every dimension. Builder also did web research (18 calls) for the first
  time in many iters — freed context headroom may have enabled this.

**Active issues:**
1. **Context growth** — HIGH. 83k/turn in iter 565 (↓17% from 100k peak).
   Compression helped but +9% growth trend persists. Main driver: file reads
   scale with codebase size. Anthropic Context Engineering article (2025)
   confirms: find smallest high-signal token set.
2. **Fix cycles** — IMPROVED. 3 in iter 565 (was 9). Compression and cleaner
   tool (computer_use is self-contained, not cross-cutting) both contributed.
   Checklist now covers the remaining predictable failure (system-prompt tests).
3. **Pattern lock** — ONGOING. 7/10 recent iters feature work.
4. **Re-edit rate** — 33% in iter 565 (best in recent history). Compression
   correlation: less context pollution → fewer return edits.
5. **Instruction density** — STABLE at ~172 lines (checklist grew +3 lines).

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
- **(564)** Builder prompt 184→94. Merged duplicate sections. **EFFECTIVE**.
- **(566)** System-prompt test added to tool checklist. Thesis updated.

## Evidence (updated iter 566)

- **Iter 565 metrics**: 86 calls, $5.73, 83k ctx, +43 tests, 44% rework/3
  cycles, 33% re-edit. Computer use tool = self-contained (no cross-cutting).
  Builder did web research (18 calls) — first significant research in many
  iters. Main rework: system-prompt tests broke after adding tool; builder
  checked proactively but incorrectly concluded "no change needed."
- **Iter 565 vs 563 (prompt compression effect)**: calls ↓23%, cost ↓23%,
  context ↓17%, re-edit ↓20pts, fix cycles ↓67%. Strong evidence that
  compression improves execution quality, not just token count.
- **Verify rerun ratios**: typecheck 3.4×, test 6.9×, lint 4.6× avg/iter.
- **Context trend**: 80k avg, +9% growth. Peaked at 100k (563), now 83k (565).
- **Fix cycle trend**: 1, 3, 3, 5, 1, 4, 4, 7, 9, 3. Spike in cross-cutting
  work (563: 9 cycles), clean for self-contained work (565: 3 cycles).
- **Build pass rate**: 100%.
- **Tests**: 3123 (+43 from iter 565).
- **Work pattern**: 7 feature, 3 architecture in last 10.
- **Research**: 2/10 iters, 29 calls (14/iter avg). Builder researches when
  building complex/unfamiliar tools.
- **Instruction load**: ~172 lines (was 169; checklist grew +3 lines).
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
| Anthropic Context Engineering (2025) | Smallest high-signal token set; models degrade past ~1M regardless of window |
| Anthropic Code Execution MCP (2025) | Script-based tool bundling reduces context 98% vs individual calls |
| Factory.ai Linters as Arch Specs (2025) | Encode conventions as lint rules for instant deterministic feedback |
| EvolveR (arXiv 2510.16079) | Experience distillation into guiding/cautionary principles — validates BUILDER_LESSONS |
| ICML 2025 Metacognitive Learning | True self-improvement needs reasoning about WHY failures happen, not just fixing |
| Tweag TDD for Agents (2025) | One test at a time prevents compound failures in multi-file changes |

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
| Computer use (mouse/keyboard control) | ✓ | Unit |
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
- **Compression improves execution quality, not just cost**: Iter 565 showed
  improvements across ALL metrics (context, re-edit, fix cycles, cost) after
  prompt compression. Less instruction text → more headroom for reasoning →
  better decisions. This is the strongest evidence yet for compression > addition.

## Strategic Priorities (for the improver, not the builder)

1. **Context growth** — HIGH. 83k/turn (↓17% from peak). Compression (564)
   bent the curve but +9% growth trend persists. Next lever: Anthropic Code
   Execution MCP pattern (script bundling) or Factory.ai approach (lint rules
   as instant architecture checks, reducing test rerun need).
2. **Instruction density** — STABLE at ~172 lines. Near ~150 threshold.
   Monitor for regressions. Further compression would require removing content.
3. **Fix cycle predictability** — Checklist now covers 6 files for tool
   registration. The remaining unpredictable failures come from cross-cutting
   changes (shared types, mocks). Test rerun ratio at 6.9× (highest of all
   verify types) is the signal to watch.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
5. **Pattern lock** — 7/10 feature work. Eval criterion helps but insufficient.
   Builder naturally does architecture when the problem calls for it (563:
   providers, 561: tool registry).
