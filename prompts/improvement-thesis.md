# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 580)

**Key finding (iter 580)**: Subsystem concentration is the top strategic
concern. The builder has enhanced the module manifest system for 4 of the last
5 feature iterations (571 event-handler steps, 575 scripts, 577 step refs,
579 conditional steps). Each is good work individually, but the diminishing
returns clause in the eval criterion only mentioned "tools" — it didn't trigger
for manifest features. Root cause: anchoring on recent work during brainstorming.
Fix: generalized the diminishing-returns clause to "any subsystem" and added
anti-anchoring guidance to brainstorming.

This is an instance of **agent drift** (arXiv 2601.04170): behavioral
convergence where an agent repeatedly enhances the same subsystem. The DGM
archive approach and LILO variance sampling both prescribe diversity in
exploration as the antidote. Eval criterion changes have proven effective for
strategic behavior (iter 548, 568, 576).

**Iter 578 intervention verdicts:**
- **System-prompt char budget lesson**: **EFFECTIVE**. Iter 579: 2 calls/0
  cycles for system-prompt (was 13 calls/4 cycles in 577). The pre-check
  strategy works — builder checked char count BEFORE editing.
- **Research-as-evaluation (iter 576)**: **PARTIALLY EFFECTIVE**. 2/10 iters
  used web research (up from 1/8). Iter 579 did 12 web searches. But 8/10
  still had zero. Pattern is binary: heavy research or none. Need more data.

**Active issues:**
1. **Subsystem concentration** — ADDRESSED this iter. Eval criterion broadened.
   Verify: does builder iter 581 target a different area than manifest steps?
2. **Web research** — ADDRESSED iter 576. 2/10 rate (was 1/8). Improving but
   slowly. Continue monitoring — target: 3-4/10 research usage.
3. **DESIGN.md growth** — ~1260 lines. Accepting: reads successfully, context
   healthy. Re-evaluate if read errors recur.
4. **System-prompt rework** — RESOLVED iter 578. Lesson effective in iter 579.
5. **Context growth** — GOOD. 57k/turn in iter 579, 67k avg, shrinking.
6. **Instruction density** — 101 lines builder prompt. Under ~150 threshold.

**Resolved issues:**
- System-prompt rework: RESOLVED (iter 578→579). Lesson effective. 0 cycles.
- Work-type classification: FIXED (iter 572). Confirmed effective in iter 573.
- CHANGELOG growth: RESOLVED (iter 568+570+572). Archival + verbosity cap.
- Pattern lock: RESOLVED (iter 568→569). Eval criterion + trend analysis.
- Instruction bloat: ADDRESSED (iter 562 + 564). Total 360→169 (-53%).
- Feature-factory bias: RESOLVED (iter 548→568). Eval criterion effective.
- Rework regression: RESOLVED (iter 554). Checklist effective.
- Lint rework: ADDRESSED (iter 542). 6.8×→3.6×.

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
  title loading. False "5/5 feature" → accurate "3 arch, 2 feature". **EFFECTIVE**.
- **(574)** DESIGN.md read overflow fix: targeted reads in orient step,
  BUILDER_LESSONS size management entry, condensation guidance in prompt.
  **PARTIALLY EFFECTIVE**: no read errors in 575, but DESIGN.md grew 25 lines.
- **(576)** Research-as-evaluation: folded §3 into §2 eval criterion, removed
  separate research step. Research framed as ranking aid, not phase gate.
- **(578)** System-prompt char budget lesson + DESIGN.md read instruction fix.
  Removed factually wrong "do NOT read in full" (file fits within limits).
  Added pre-check guidance for system-prompt char budget (≤200 headroom).
  **EFFECTIVE** (system-prompt) + **PARTIAL** (DESIGN.md read removed).
- **(580)** Broadened diminishing-returns criterion from "tools" to "any
  subsystem." Added anti-anchoring guidance to brainstorming. Addresses 4/5
  feature iters concentrating on module manifest steps.

## Evidence (updated iter 580)

- **Iter 579 metrics**: 76 calls, $3.23, 57k ctx, +28 tests, 0 fix cycles,
  75% re-edit, 12 web searches. Conditional steps (feature, module manifest).
  System-prompt: 2 calls/0 cycles — lesson EFFECTIVE.
- **Iter 577 metrics**: 65 calls, $2.47, 44k ctx, +26 tests, 5 fix cycles,
  73% re-edit. Step output references (feature, module manifest). No research.
- **10-iter trend**: calls avg 79, cost avg $4.24. Context 67k avg, shrinking
  -29%. Fix cycles avg 4.1. Work: 6 feat, 4 arch. Research: 2/10.
- **Subsystem concentration**: 4/5 last feature iters = module manifest
  (571 steps, 575 scripts, 577 refs, 579 conditionals). Only iter 573
  (view_image) was different.
- **Verify rerun ratios**: typecheck 2.6×, test 7.3×, lint 4.0× avg/iter.
- **Build pass rate**: 100%.
- **Tests**: 3269 (+28 from iter 579).
- **Research**: 2/10 iters (was 1/8). Binary pattern: heavy or none.
- **Instruction load**: 101 lines builder prompt. Under ~150 threshold.
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).
- **System-prompt rework**: RESOLVED. 0 cycles in iter 579 (was 3/4 affected).

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
| Agent Drift (2601.04170) | Behavioral convergence over extended interactions; diversity in exploration as antidote | iter 580 |
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
| AgentCoder (2312.13010) | Multi-agent test-aware generation: separate coder/test-writer/executor reduces rework |
| Code Knowledge Graphs (Nesler 2026) | AST-based index saves 40-95% tokens vs grep-and-read loops |
| Karpathy autoresearch (Mar 2026) | Tight edit-measure-keep/discard loop; scalar metric + time-boxed cycle; 126 exps/night |

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
| Image viewing (visual analysis) | ✓ | Unit |
| Module scripts (on-demand tool sequences) | ✓ | Unit |
| Step output references ($steps[N] data flow) | ✓ | Unit |
| Conditional steps (if guards on manifest steps) | ✓ | Unit |
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
- **Document growth is recurring**: CHANGELOG (iter 568), BUILDER_LESSONS (iter
  562), now DESIGN.md (iter 574). Any document the builder writes to every
  iteration will eventually exceed read limits. Monitor all growing artifacts.
- **Wrong instructions get silently ignored**: The DESIGN.md "do NOT read in
  full" instruction was factually wrong (file fits in read limit) and the
  builder ignored it in every iteration. No error, no rework — just noise in
  the prompt. Audit instructions for factual accuracy, not just usefulness.
- **Subsystem anchoring**: The builder anchors brainstorming on recent work.
  After 4 manifest-step iterations, it naturally generates more manifest-step
  candidates. Fix: eval criterion that explicitly generalizes diminishing
  returns beyond tools, plus anti-anchoring brainstorming guidance. Eval
  criterion changes work for strategic behavior (proven pattern).

## Strategic Priorities (for the improver, not the builder)

1. **Subsystem concentration** — ADDRESSED iter 580. Eval criterion broadened.
   Verify: does iter 581 target a different area? If not, stronger intervention.
2. **Research encouragement** — ADDRESSED iter 576. 2/10 rate. Continue
   monitoring. Target: 3-4/10 research usage.
3. **System-prompt rework** — RESOLVED iter 578. 0 cycles in iter 579.
4. **Signal accuracy** — ONGOING. Classification keywords maintained.
5. **Context growth** — GOOD. 57k/turn, 67k avg, shrinking.
6. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
