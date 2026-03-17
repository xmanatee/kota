# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 584)

**Key finding (iter 584)**: Operational efficiency is healthy — the iter 582
interventions both landed. The next improvement lever is **decision quality**,
not efficiency. The builder's eval criterion is all abstract ("diminishing
returns," "architecture as capability"). Research (Sarukkai et al. NeurIPS 2025,
practitioner few-shot studies) shows that concrete worked examples improve
pattern matching from 40-60% to 85-95% accuracy and task completion from 73% to
93%. Adding 3 condensed examples of strong past choices to the eval criterion
grounds the abstract guidance in concrete precedent.

**Iter 582 intervention verdicts:**
- **DESIGN.md read efficiency (prompt + lesson)**: **EFFECTIVE**. Builder grepped
  headers at call 4, then 1 targeted read at call 72 (docs). Context: 55k/turn
  (was 108k). Cost: $3.72 (was $8.12). Exactly as prescribed.
- **Subsystem concentration (explicit classification)**: **PARTIALLY EFFECTIVE**.
  Builder chose SQLite memory provider — still module-adjacent (providers), but
  classified as "architecture," addressed owner's direct request, and candidate
  list included non-module options. Progress from iter 580, not a complete break.

**Active issues:**
1. **Decision quality** — NEW iter 584. Abstract eval criterion → concrete
   examples. Verify: does iter 585 brainstorm more diverse candidates?
2. **Subsystem concentration** — DOWNGRADED. Builder making better choices
   within constraint. Continue monitoring. May resolve naturally with examples.
3. **Web research** — 3/10 rate (iters 579, 583 had research). Improving.
4. **Instruction density** — 105 lines builder prompt. Under ~150 threshold.

**Resolved issues (iter 584):**
- **DESIGN.md read bloat**: RESOLVED (iter 582→583). Prompt + lesson effective.
  Builder grepped headers, 1 targeted read, context back to 55k.
- **Context growth**: RESOLVED. Back to 55k/turn (was 108k in 581).

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
  subsystem." Added anti-anchoring guidance to brainstorming. **PARTIALLY
  EFFECTIVE**: builder acknowledged but still chose modules (5/6 recent).
- **(582)** DESIGN.md read efficiency (prompt + lesson) + subsystem diversity
  sharpening (explicit system classification). **EFFECTIVE** (DESIGN.md: 1 read,
  55k ctx, $3.72) + **PARTIALLY EFFECTIVE** (still module-adjacent but better).
- **(584)** Concrete worked examples in eval criterion. Research-backed
  (Sarukkai et al., 73→93%). Targets: more diverse brainstorming in iter 585.

## Evidence (updated iter 584)

- **Iter 583 metrics**: 77 calls, $3.72, 55k ctx, +25 tests, 1 fix cycle,
  50% re-edit, 5 web searches. SQLite memory provider (architecture, modules).
  1 DESIGN.md read (docs only) — **DESIGN.md fix confirmed effective**.
- **Iter 581 metrics**: 113 calls, $8.12, 108k ctx, +8 tests, 5 fix cycles,
  56% re-edit, 0 web searches. Module persistent logging (feature, modules).
- **Iter 579 metrics**: 76 calls, $3.23, 57k ctx, +28 tests, 0 fix cycles,
  75% re-edit, 12 web searches. Conditional steps (feature, modules).
- **DESIGN.md read pattern**: RESOLVED. Grepped headers + 1 targeted read is
  the stable pattern now (iters 575-579, 583). Cost/context normal.
- **10-iter trend**: calls avg 74, cost avg $3.90. Context 64k avg.
  Fix cycles avg 3.3. Work: 7 feat, 3 arch. Research: 3/10 (improving).
- **Tests**: 3324 (+25 from iter 583). Build pass rate: 100%.
- **Instruction load**: 105 lines builder prompt. Under ~150 threshold.
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
| Agent Drift (2601.04170) | Behavioral convergence over extended interactions; diversity in exploration as antidote | iter 580 |
| Self-Generated Examples (Sarukkai NeurIPS 2025) | Self-generated trajectory examples: 73→93% on ALFWorld; exceeds model upgrades | iter 584 |
| Few-Shot Pattern Match (practitioner 2025) | Concrete examples: 40-60%→85-95% pattern accuracy; revision cycles 3-5→1-2 | iter 584 |
| Aider Architect/Editor (2024) | Separation improves edit correctness 92%→100% | Background |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| SAGE (2512.17102) | Convert successful patterns to reusable skills |
| SkillRL (2602.08234) | Hierarchical skill bank with success/failure signals |
| SICA (2504.15228) | Agent reviews own performance, edits own code/prompts (17→53%) |
| ReVeal (2506.11442) | Pre-flight self-critique before running checks reduces rework |
| OpenEvolve/AlphaEvolve (2025) | Evolutionary prompt optimization; meta-prompt evolution alongside code |
| SWE-PRM (IBM NeurIPS 2025) | Mid-execution course correction via process reward model; 40→50.6% |
| Meta ACH/MutGen (FSE 2025) | Mutation testing feedback loop for AI-written tests; 73% engineer acceptance |
| Strategic Self-Improvement (2512.04988) | Metacognition (accurate self-assessment) is largest single factor in work selection |
| OpenHands Critic (Nov 2025) | Trained critic selects best among N rollouts; log-linear improvement |
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
| Module persistent logging (audit trail) | ✓ | Unit |
| SQLite memory provider (alt backend) | ✓ | Unit |
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
- **Specificity matters in eval criteria**: "Any subsystem" (iter 580) was too
  vague — builder treated "module logging" as distinct from "module manifest
  steps." Adding explicit system classification examples (iter 582) closes the
  loophole. General principles need concrete examples to be actionable.
- **Read strategy variation**: RESOLVED. Explicit `grep '^##'` instruction +
  lesson with cost data stabilized the pattern. Iter 583 followed it perfectly.
- **Concrete examples > abstract principles**: Eval criteria with abstract
  principles ("diminishing returns," "architecture as capability") work for
  strategic behavior but the builder still generates narrow candidates. Research
  (Sarukkai et al., few-shot practitioner studies) shows concrete worked examples
  improve pattern matching 40-60%→85-95%. Added iter 584.

## Strategic Priorities (for the improver, not the builder)

1. **Decision quality** — NEW iter 584. Concrete examples in eval criterion.
   Verify: does iter 585 brainstorm more diverse candidates?
2. **Subsystem concentration** — DOWNGRADED. Partially addressed. Monitor.
3. **Research encouragement** — 3/10 rate (improving). Monitor.
4. **Signal accuracy** — ONGOING. Classification keywords maintained.
5. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
6. **Test quality verification** — FUTURE. Mutation testing (Meta ACH/MutGen)
   could verify AI-written tests actually catch bugs. High value, medium effort.
