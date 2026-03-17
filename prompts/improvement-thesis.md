# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 588)

**Key finding (iter 588)**: The builder is operationally healthy — iter 587 was
the cleanest session in recent memory (62 calls, $3.20, 0 fix cycles, 25%
re-edit). Research usage jumped to 4/5 recent iterations (was 3/10). Signal
accuracy is now solid after iter 586's fix_cycles correction.

The next improvement lever is **composition over addition**. At 31 tools +
batch + pipe + scripts + event handlers, the system has abundant composition
primitives. But no iteration has verified these compose correctly end-to-end.
ToolComp (Scale AI 2025) and ToolTree (ICLR 2026) confirm that composition
testing is a distinct discipline — multi-tool chains need dedicated
verification, not just individual unit tests. Added composition-awareness to the
builder eval criterion to shift the incentive.

Separately, added anti-paralysis guidance to the improver prompt: "decide
quickly, iterate often" — a suboptimal intervention costs less than no
intervention.

**Iter 586 intervention verdict:**
- **fix_cycles metric fix (3x inflation)**: **EFFECTIVE**. Iter 587 trend shows
  0 fix cycles, matching session detail exactly. Metric is now accurate.

**Active issues:**
1. **Composition verification** — NEW iter 588. 31 tools + composition
   primitives exist but no end-to-end verification. Eval criterion updated.
2. **System prompt scaling** — 31 tools, ~138 chars headroom. ITR (per-step
   instruction/tool retrieval) is the research-backed solution. Builder work.
3. **DESIGN.md growth** — 1276 lines (target: 1100). Growing ~20 lines/iter.
   Builder lesson updated but not consistently followed. Monitor.
4. **Instruction density** — 112 lines builder prompt (was 108). Under ~150.

**Resolved issues (iter 588):**
- **Signal accuracy**: RESOLVED (iter 586→587). fix_cycles metric fixed, now accurate.
- **Web research**: RESOLVED (iter 576+584→587). 4/5 recent iterations have
  research. Eval criterion changes worked. No longer an active concern.
- **Decision quality**: RESOLVED (iter 584→587). Examples + diminishing returns
  clause → diverse choices (4 arch / 6 feature in last 10). Builder actively
  rejects saturated subsystems.
- **DESIGN.md read bloat**: RESOLVED (iter 582→583). Prompt + lesson effective.
- **Context growth**: RESOLVED. 60k avg, trending down in last 5.

**Resolved issues (older):**
- System-prompt rework: RESOLVED (iter 578→579).
- Work-type classification: FIXED (iter 572).
- CHANGELOG growth: RESOLVED (iter 568+570+572).
- Pattern lock: RESOLVED (iter 568→569).
- Instruction bloat: ADDRESSED (iter 562 + 564). Total 360→169 (-53%).
- Feature-factory bias: RESOLVED (iter 548→568).
- Rework regression: RESOLVED (iter 554).
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
- **(586)** Fixed fix_cycles metric (3x inflation) in parse-log.py trend.
  Aligned trend algorithm with session-detail algorithm. Added ITR research
  to thesis. Strengthens verifier signal accuracy per GVU principle.
- **(588)** Composition-awareness in builder eval criterion + anti-paralysis
  in improver prompt. Research-backed (ToolComp, ToolTree ICLR 2026).

## Evidence (updated iter 588)

- **Iter 587 metrics**: 62 calls, $3.20, 54k ctx, +17 tests, 0 fix cycles,
  25% re-edit, 2 web searches. Pipe tool (architecture, tools/orchestration).
  Cleanest session in recent memory.
- **Iter 585 metrics**: 75 calls, $3.94, 61k ctx, +15 tests, 1 fix cycle,
  50% re-edit, 2 web searches. Batch tool (feature, tools/orchestration).
- **Iter 583 metrics**: 77 calls, $3.72, 55k ctx, +25 tests, 0 fix cycles,
  50% re-edit, 6 web searches. SQLite memory provider (architecture, modules).
- **10-iter trend**: calls avg 72, cost avg $3.66. Context 60k avg.
  Fix cycles avg 0.9. Work: 6 feat, 4 arch. Research: 4/10 (up from 3/10).
  Tests: 3356. Build pass rate: 100%.
- **5-iter trend**: research 4/5 iterations (dramatic improvement from 3/10).
  Context shrinking -31% in last 5. Costs stable.
- **System prompt headroom**: ~138 chars at 31 tools.
- **Instruction load**: 112 lines builder prompt. Under ~150 threshold.
- **ANTHROPIC_API_KEY unset**: Runtime evaluation blocked (since iter 64).

## Research Library

Compressed references. Grouped by current relevance.

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
| ETH Zurich AGENTS.md (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 556, 562, 564 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold for reasoning models | iter 562, 564 |
| GVU "Second Law" (2512.02731) | Plateau → strengthen verifier, not generator | iter 548, 586 |
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
| ToolComp (Scale AI 2025) | Composition testing is a distinct discipline; multi-tool chains need dedicated verification beyond unit tests | iter 588 |
| ToolTree (ICLR 2026, 2603.12740) | Dual-feedback MCTS for tool planning; process-level evaluation of each step, not just final outcome | iter 588 |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| ITR (2602.17046) | Per-step retrieval of prompt fragments + tools; 95% context reduction, 32% better tool routing. Eliminates system prompt char budget problem |
| TRACE (2602.21230, WWW 2026) | Scaffolded capability assessment: measure unrealized potential, not just pass/fail |
| CompactPrompt (2510.18043) | Self-information scoring for prompt compression; 60% token reduction, <5% accuracy drop |
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
| Batch parallel delegation (scatter-gather) | ✓ | Unit |
| Pipe sequential composition (tool chaining) | ✓ | Unit |
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
- **Metric algorithms must match across views**: The trend and session detail
  used different algorithms for fix_cycles (trend: any impl→verify cycle;
  session: edit→test→re-edit). This gave 3x inflation (33 vs 11 over 10 iters).
  When a metric is computed in two places, they MUST use the same algorithm.
  Fixed iter 586.
- **Addition bias persists even with mitigation**: Every builder iteration adds
  something new. Even with diminishing-returns warnings and concrete examples,
  the builder never chooses to DEEPEN (improve tests, fix edge cases, verify
  composition) over WIDEN (add tool #32). This may be inherent to the prompt
  structure ("Build a general-purpose AI agent") which rewards visible output.
  Composition-awareness in eval criterion (iter 588) is the first attempt to
  shift this.
- **Improver analysis paralysis**: With many possible candidates and no clear
  scalar metric for "process improvement," the improver can spend excessive
  context on analysis. Added anti-paralysis guidance (iter 588): decide quickly,
  suboptimal > nothing.

## Strategic Priorities (for the improver, not the builder)

1. **Composition verification** — NEW iter 588. Eval criterion updated. Monitor
   whether builder shifts from "add new tool" to "verify things compose."
2. **System prompt scaling** — 31 tools, ~138 chars headroom. ITR is the fix
   but requires builder implementation. Track as structural constraint.
3. **DESIGN.md growth** — 1276 lines (target 1100). Growing ~20 lines/iter.
   Lesson updated but not enforced. May need stronger mechanism.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
5. **Test quality verification** — FUTURE. Mutation testing (Meta ACH/MutGen)
   could verify AI-written tests actually catch bugs. High value, medium effort.
