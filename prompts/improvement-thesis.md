# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 608)

**Key findings (iter 608)**:
1. Domain concentration prompt fix (iter 606) was INEFFECTIVE — builder in
   iter 607 saw CONCENTRATED warning but chose tools anyway (retry middleware).
   After 7 iterations of domain-concentration interventions (588→606), accepting
   as partially tractable. Soft warnings work sometimes (601: other, 603:
   modules) but can't prevent all concentration. Root cause may be fundamental
   to single-agent decision-making.
2. New approach: added "Owner request" brainstorming category. Builder now
   generates at least one candidate from pending NOTES.md `b:` items. This
   addresses concentration indirectly — owner priorities span diverse domains.
3. Simplified concentration section (5→2 lines) — soft guidance, not mandate.

**Confirmed (iter 606→607)**: Fix cycle detection accuracy CONFIRMED (2 cycles
reported, matches session). Edit-planning guidance inconsistent (re-edit
bounced from 38%→52% — task-dependent, not a stable improvement).

**Active issues:**
1. **Owner-priority alignment** — Builder gravitates to incremental
   infrastructure (middleware#3) over owner-requested features (dual SDK,
   module plug-n-play). New brainstorming category deployed (iter 608).
   Verify in iter 609-611.
2. **Composition verification** — Partially addressed by iter 595's E2E tests.
   Still no E2E for batch/pipe/map. ChainFuzzer: 302/365 bugs need multi-tool.
3. **System prompt scaling** — 32 tools, ~118 chars headroom. Nearly full.
4. **Implementation efficiency** — Verify reruns (test 5.6×, lint 4.4×) still
   elevated. Re-edit inconsistent (37→71→75→38→52%). Monitor.
5. **Cost volatility** — $5.40 spike in iter 607 (37% above avg). Driven by
   73k context/turn. Likely task-specific (cross-cutting refactor) not systemic.

**Resolved issues:**
- **Domain concentration**: ACCEPTED (iters 588→608). 7 iterations of
   interventions. Soft warnings partially work. Further prompt-level fixes
   are diminishing returns. The "Owner request" category addresses it
   indirectly by diversifying the candidate pool.
- **Brainstorming quality**: RESOLVED (iters 598→600→verified 601+603).
- **Web research drought**: RESOLVED (iter 600).
- **Decision quality**: RESOLVED (iter 600→verified 601+603).
- **Signal accuracy**: RESOLVED (iters 586→602→604→606).
- **Feature concentration**: RESOLVED (iters 594→602). Work-type diversity OK.
- **DESIGN.md growth**: RESOLVED (iter 596→597). 896 lines, healthy.
- **DESIGN.md read bloat**: RESOLVED (iter 582→583).
- **Build MISS false negative**: RESOLVED (iter 604). Confirmed in 605.

**Resolved issues (older):**
- System-prompt rework, work-type classification, CHANGELOG growth, pattern
  lock, instruction bloat, feature-factory bias, rework regression, lint rework.
  See intervention history for details.

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
  **INEFFECTIVE**: builder still added map (tool #32), 3rd tools/orch streak.
- **(590)** Subsystem concentration detection in trend output. Closed data gap:
  trend now shows per-iteration subsystem + streak warnings. Simplified builder
  prompt to reference subsystem data. Strengthened composition language.
  Research-backed (RAGEN Echo Trap, ICML 2025 metacognition).
  **PARTIALLY EFFECTIVE**: builder broke tools/orch streak but stayed in tools
  domain (tools/routing in 591). Subsystem-level granularity too fine.
- **(592)** Domain-level concentration tracking. Groups subsystems into broad
  domains (tools, modules, architecture). Trend shows domain frequency +
  warnings at ≥50%. Builder prompt references Domains line. Research-backed
  (Self-Play Information Gain, Verbalized Sampling).
  **PARTIALLY EFFECTIVE**: builder chose modules in 593 (broke tools streak)
  but 10-iter: 6 modules + 4 tools = 100% in 2 domains, 80% feature. Domain
  signal works for domain diversity but doesn't address work-type concentration.
- **(594)** Work-type concentration signal + capability frontier framing. Trend
  Work pattern line now warns when feature ≥70%. Builder prompt reframed from
  domain-avoidance to "what can the agent almost-but-not-quite do?" Research:
  CURATE (ICML 2025, competence boundary), Metacognitive Learning (ICML 2025).
  **EFFECTIVE**: builder chose E2E hardening in iter 595, citing concentration
  warning. Resolves the concentration whack-a-mole arc (iters 588→594).
- **(596)** DESIGN.md health check in trend output + test delta regex fix.
  Document growth (1287 lines, +17% over 1100 target) surfaced as data signal.
  Per proven pattern "data > instructions." Test delta regex now handles
  "N tests pass (+M new)" format (was showing "?" for iter 595).
  **EFFECTIVE** (DESIGN.md signal) — builder condensed 1287→884 in iter 597.
  **SIDE EFFECT**: bulk condensation consumed 30 calls, 76% rework. Updated
  BUILDER_LESSONS with incremental condensation guidance.
- **(598)** Divergent-convergent brainstorming in builder prompt. Feature
  concentration persisted at 8/10 despite 4 iterations of warnings — builder
  rationalizes features as "architecture hardening." Root cause: single-phase
  brainstorm lets model converge on features before alternatives are generated.
  Research: CreativeDC (arXiv:2512.23601, diverge/converge phases), CHI 2025
  Artificial Hivemind (RLHF mode-collapse in ideation). Named categories (new
  capability, deepen existing, architecture) force diverse candidate pool.
  Also updated BUILDER_LESSONS for DESIGN.md incremental condensation.
  **STRUCTURALLY EFFECTIVE, SUBSTANTIVELY HOLLOW**: builder followed format,
  chose architecture (breaking feature streak), but pre-decided in thinking
  block. Non-chosen candidates were stubs. Zero research.
- **(600)** Research-before-convergence in Phase 2. Moved web research from
  end-of-section suggestion to first action in Phase 2: "Pick your top 2
  candidates and search the web for prior art... only after comparing, commit."
  Creates a tool-call barrier between diverge and converge that the thinking
  block cannot skip. Research: ChainFuzzer (2603.12614, composition testing),
  HGM (2510.21614, Clade-Metaproductivity), Chroma context rot (2025).
  **VERY EFFECTIVE**: builder did 21 web searches in iter 601 (was 0 in 595-599).
- **(602)** Work-type classification fix + Shannon entropy diversity metric.
  Summary-line context for richer keyword matching, expanded architecture
  keywords (middleware, telemetry, state machine, lifecycle), new hardening
  category, entropy-based diversity (arxiv 2511.15593). Replaced false "5/5
  feature CONCENTRATED" with accurate "3 architecture, 1 feature, 1 hardening
  — diversity 86%". Research: Tangled Code Changes (2505.08263), Agent Drift
  ASI (2601.04170), AMDM (2509.00115).
- **(604)** Implementation-phase analytics + verification signal fix. Fixed
  build MISS false negative (combined "typecheck && build" excluded by
  overzealous filter). Added edits-per-file metric + zero-fix-cycle streak
  counter to trend. Updated BUILDER_LESSONS "Batch Edits" with concrete data
  (iter 603: 7 edits/file). Added edit-planning reminder to builder prompt
  step 3. Research: SICA (self-improving code agent), EvolveR (trajectory
  distillation), Agentless (localize-then-repair), SWE-PRM (taxonomy-guided
  correction). Shifts improver focus from brainstorming (resolved) to
  implementation efficiency (untouched since iter 542 lint batching).
- **(606)** Two signal accuracy fixes. (a) Domain concentration: builder prompt
  referenced "Work pattern" line but CONCENTRATED only appears on "Domains"
  line. Prompt now references both. (b) Fix cycle detection: algorithm
  required tight edit→test→edit with no intervening calls, but verify calls
  (typecheck, build) and diagnostic calls (Read, Grep) always separate them
  in practice. 0 reported vs 7 actual across 10 iters. Fix: only Write/Agent
  break the chain. Both session detail and trend algorithms updated.
  **Domain fix INEFFECTIVE** (607 still chose tools). **Fix cycles CONFIRMED**.
- **(608)** Owner-priority brainstorming category + concentration simplification.
  After 7 iterations of domain-concentration interventions with limited
  success, accepted as partially tractable. New approach: added "Owner
  request" as 4th brainstorming category so builder generates candidates from
  pending NOTES.md `b:` items. Simplified concentration section (5→2 lines).
  Research: PromptWizard (self-critique instruction refinement), S2R (trained
  self-verification), EvolveR (trajectory principle distillation).

## Evidence (updated iter 608)

- **Iter 607 metrics**: 93 calls, $5.40, 73k ctx, +14 tests, 2 fix cycles,
  47% rework, 52% re-edit, 5 web research calls. Cost spike driven by
  context/turn (cross-cutting middleware refactor with many test updates).
- **5-iter trend (599-607)**: calls avg 92, cost avg $3.94, +21.0 tests/iter.
  Context 54k avg (growing +6%). 5 fix cycles total. Re-edit 55% avg.
  Verify reruns: test 5.6×, lint 4.4×,
  build 1.4×. Domains: 3/5 tools CONCENTRATED. Work pattern: 4/5 architecture,
  diversity 46%. Web research: 4/5 iters, 68 total (17/iter avg).
- **Domain concentration arc**: 7 improver iterations (588→606) produced
  signals (domain tracking, work-type tracking, diverge/converge, research
  injection) that partially work — builder diversifies sometimes (601, 603)
  but gravitates back (605, 607). Accepted as partially tractable.
- **System prompt headroom**: ~118 chars at 32 tools. Nearly full.
- **Instruction load**: ~99 lines builder prompt (net -2 from iter 608).
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
| RAGEN Echo Trap (2504.20073) | Agents overfit to locally-rewarded patterns; reward variance cliff = concentration signal; detection is prerequisite to mitigation | iter 590 |
| Intrinsic Metacognition (ICML 2025, 2506.05109) | Fixed human-designed loops can't detect stuckness; agents need self-assessment of where they're concentrating | iter 590 |
| Self-Play Information Gain (2603.02218) | Without explicit diversity tracking, self-improvement drifts to repetitive work; each iteration must introduce learnable new signal | iter 592 |
| Verbalized Sampling (2510.01171) | Explicit variation requests counteract mode collapse from alignment narrowing | iter 592 |
| Diversity Collapse in RLVR (2509.07430) | Coarse reward signals collapse subsolution diversity; finer-grained divergence-aware signals preserve exploration | iter 592 |
| CURATE (ICML 2025) | Pick easiest unsolved task at competence boundary → naturally diversifies work types without explicit rotation | iter 594 |
| ACE (ICLR 2026, 2510.04618) | "Grow-and-refine" for evolving context: accumulate structured entries, periodically curate. Prevents "context collapse" where iterative rewriting erodes domain insights. +10.6% on agent benchmarks | iter 596 |
| CreativeDC (2512.23601) | Divergent-convergent two-phase prompting: separate generation from selection to prevent mode-collapse in ideation | iter 598 |
| CHI 2025 Artificial Hivemind (3706598.3714198) | RLHF-aligned LLMs converge toward statistically average responses; repeated assistance decreases originality | iter 598 |
| AlphaEvolve Dual Sampling (DeepMind 2025) | Parent + inspiration sampling from different feature bins; MAP-Elites ensures population diversity; directly applicable to work-type diversity | iter 598 |
| EXIF Scout Pass (2025) | Separate exploration agent discovers feasible tasks, identifies target agent's gaps; closed-loop explore→train→evaluate→explore | Future |
| ChainFuzzer (2603.12614) | 302/365 agent vulnerabilities require multi-tool execution; single-tool testing misses composition bugs | iter 600 (thesis) |
| HGM Clade-Metaproductivity (2510.21614) | Evaluate iterations by whether they enable future improvement, not just current pass rate. Metaproductivity-Performance Mismatch | iter 600 (thesis) |
| ToolGym (2601.06328) | Planning-execution misalignment: models plan correct tool sequences but fail at execution (and vice versa). 5571 tools, MCP format | iter 600 (thesis) |
| ToolRLA (2603.01620) | Multiplicative reward decomposition for tool chains: one broken tool zeros the chain | iter 600 (thesis) |
| Tangled Code Changes (2505.08263) | LLM few-shot+CoT achieves F1=0.88 for commit type classification; combining message+diff is key | iter 602 (thesis) |
| Ideation Diversity (2511.15593) | Shannon entropy on work-type distribution correlates with agent performance; 3.5 categories in 5 iters for top agents | iter 602 |
| AMDM (2509.00115) | EWMA thresholds + Mahalanobis distance for multi-dimensional drift detection; 0.9% false positive rate | iter 602 (thesis) |
| SICA (2504.15228) | Self-improving code agent: edits own prompts/heuristics, best-performer-as-meta-agent. 17→53% on SWE-Bench subset. File editing accuracy 82→94% | iter 604 (research) |
| EvolveR (2510.16079) | Trajectory distillation: success→guiding principles, failure→cautionary principles. Offline distill + online retrieval | iter 604 (research) |
| Agentless localize-then-repair | Three phases: hierarchical localization, search/replace repair, patch validation. Separating localization from editing prevents wasted edits | iter 604 (research) |
| SWE-PRM taxonomy correction (2509.02360) | Taxonomy of SWE agent failures + PRM mid-trajectory feedback. +5-11pp resolution, trajectory lengths maintained | iter 604 (research) |
| ABC-Bench (2601.11077) | r=0.87 correlation between trajectory depth (including fix cycles) and task success. Fix cycles = engagement depth, not just rework | iter 606 (research) |
| AgentDiet (2509.23586) | Waste taxonomy for trajectories: expired/redundant/useless steps. 40-60% token reduction, no perf loss. Could classify productive vs churning fix cycles | iter 606 (research) |
| PromptWizard (Microsoft 2025) | LLM iteratively critiques+refines its own instructions and examples in tandem. Combines exploration (diverse candidates) with exploitation (refine best) | iter 608 (research) |
| S2R (ACL 2025) | Self-verification as trainable skill: SFT on 3.1k examples + outcome-level RL. 51→82% accuracy. Outcome-level RL > process-level for self-correction | iter 608 (research) |
| Self-Evolving Agents Survey (2508.07407) | Unified framework: 4 evolution dimensions (memory, tools, plans, weights). Taxonomy for deciding which dimension to evolve | iter 608 (research) |
| EvoPrompt/DEEVO (2506.00178) | Evolutionary mutation of prompts with Elo-based fitness from structured debates. Tournament selection without hand-crafted reward | iter 608 (research) |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| ITR (2602.17046) | Per-step retrieval of prompt fragments + tools; 95% context reduction, 32% better tool routing. Eliminates system prompt char budget problem |
| TRACE (2602.21230, WWW 2026) | Scaffolded capability assessment: measure unrealized potential, not just pass/fail |
| ACON (2510.00615) | Failure-aware context compression: compare full vs compressed outcomes, iteratively refine rules. 26-54% reduction, >95% accuracy. Applicable to DESIGN.md pruning |
| SWE-EVO (2512.18470) | Fix Rate metric captures partial progress, reveals gains binary pass/fail hides. Multi-file evolution tasks vs single-issue benchmarks |
| ContextEvolve (2602.02597) | Three-agent context compression (Summarizer+Navigator+Sampler). 33% better, 29% less tokens |
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
| Map parallel apply (homogeneous tool fan-out) | ✓ | Unit |
| Progressive tool disclosure (context-sensitive groups) | ✓ | Unit |
| Working memory (session scratchpad) | ✓ | Unit + E2E |
| Multi-turn conversation | ✓ | Composition E2E |
| Error recovery in agent loop | ✓ | Composition E2E |
| Module→tool pipeline (load+register+execute) | ✓ | E2E (iter 595) |
| Module event bus lifecycle | ✓ | E2E (iter 595) |
| Multi-module composition | ✓ | E2E (iter 595) |
| Tool telemetry (self-monitoring) | ✓ | Unit + Integration (iter 597) |
| Tool middleware (composable pre/post hooks) | ✓ | Unit (iter 599) |
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
  the builder never chooses to DEEPEN over WIDEN. Root cause identified (iter
  590): the eval criterion told the builder to classify by subsystem but the
  trend data only showed feature/architecture — the builder couldn't see
  concentration because the data didn't surface it. Fix: subsystem classification
  in trend output + streak warnings. Words without data don't change behavior.
- **Data gaps undermine criteria**: When an eval criterion references information
  the builder must manually derive, it's unreliable. Provide the data directly
  in the tools the builder already uses (trend output). Same principle as
  "concrete examples > abstract principles" — concrete data > abstract rules.
- **Classification granularity affects detection**: Subsystem-level tracking
  (iter 590) let the builder shift between tools/orch and tools/routing while
  staying in the same domain. Fine-grained labels are useful for understanding
  what was done, but concentration detection needs coarser domain-level grouping.
  Multiple granularity levels in a single view (subsystem for detail + domain
  for concentration) is the right pattern.
- **Improver analysis paralysis**: With many possible candidates and no clear
  scalar metric for "process improvement," the improver can spend excessive
  context on analysis. Added anti-paralysis guidance (iter 588): decide quickly,
  suboptimal > nothing.
- **Concentration whack-a-mole**: Iters 588→598 added layers of intervention:
  data signals (subsystem→domain→work-type), structural format (diverge/
  converge), positive framing (capability frontier). The builder satisfies
  structural requirements without genuine engagement. Iter 598's diverge/
  converge was "structurally effective, substantively hollow" — the builder
  pre-decided in its thinking block, then wrote post-hoc Phase 1/2 labels.
  The next layer (iter 600): information injection via mandatory research
  between diverge and converge, creating a tool-call barrier the thinking
  block cannot bypass. If this also fails, the problem may be fundamental to
  single-agent decision-making (would need population-based approaches per
  DGM/AlphaEvolve).
- **Thinking-block pre-commitment**: When a model uses extended thinking, it
  often commits to a decision BEFORE generating externalized output. Structural
  requirements on the output (like "write Phase 1 then Phase 2") only affect
  the post-hoc rationalization, not the actual decision. To genuinely change
  decisions, inject NEW INFORMATION (via tool calls) between decision phases.
  Tool calls create hard breaks in the thinking-generation cycle.
- **Document growth is a recurring pattern**: CHANGELOG (iter 568),
  BUILDER_LESSONS (iter 562), DESIGN.md (iter 596). Any document the builder
  writes to every iteration will grow past limits. The fix is always the same:
  surface the data (line count vs target) in the tools the builder already
  uses. Text instructions to "keep it under X" are ignored without data.
- **Brainstorming optimization is complete**: Iters 598→600→602 addressed
  brainstorming quality (diverge/converge format, research-before-convergence,
  classification fix). Verified in 601+603 — both did 21+ web searches, genuine
  comparison. Further brainstorming tweaks are diminishing returns. The next
  frontier is implementation-phase efficiency: edit planning, verification
  strategy, incremental vs batched editing.
- **Keyword-based classification drifts**: Architecture keywords (iter 572) and
  work-type classification (iter 602) both needed periodic expansion as the
  builder creates new types of work the keyword list doesn't cover. This is
  inherent to keyword approaches. Each time, the false signal persisted for
  multiple iterations before detection. Continuous-value metrics (Shannon
  entropy) are more robust than threshold-based signals. Long-term, LLM-as-
  judge classification (F1 0.88 vs ~0.65 for keywords) would eliminate this
  maintenance burden.
- **Prompt→signal regression during compression**: Iter 592 added a Domains
  reference to the builder prompt. Iter 594 rewrote the concentration section
  without preserving it. This misalignment persisted for 12+ iterations with
  7/10 tools domain concentration. When restructuring prompt sections, audit
  all metric/line references against the actual trend output to ensure they
  still match. Structural changes to prompts should be followed by a reference
  integrity check.
- **Metric algorithms must model actual workflows**: Fix cycle detection
  required tight edit→test→edit but the builder always does edit→typecheck→
  build→test. The verify calls broke the chain, causing 0/7 actual cycles
  to be reported. When designing metrics, trace through several real sessions
  to ensure the algorithm matches how the builder actually works, not how you
  imagine it works. This is the third metric accuracy fix (586: 3x inflation,
  604: build MISS, 606: fix cycle undercount).
- **Know when to accept partial results**: Domain concentration was chased for
  7 iterations (588→606) with increasingly sophisticated interventions. Each
  partially worked but the builder found workarounds. After 7 iterations, the
  return on further prompt tweaking was clearly negative. Signs of an
  intractable-at-this-level problem: (a) multiple different approaches all
  partially work, (b) the builder satisfies the letter but not the spirit,
  (c) the root cause may be fundamental (single-agent mode collapse). When
  you hit 3+ iterations on the same issue, consider whether to accept partial
  results and redirect effort.

## Strategic Priorities (for the improver, not the builder)

1. **Owner-priority alignment** — Builder gravitates to incremental infra over
   owner requests. "Owner request" brainstorming category deployed (iter 608).
   Verify in 609-611: does the builder generate owner-request candidates?
2. **Implementation efficiency** — Verify reruns (test 5.6×, lint 4.4×) still
   high. Re-edit inconsistent (38→52%). Monitor for patterns.
3. **Composition verification** — Partially addressed (iter 595 E2E tests).
   Still no E2E for batch/pipe/map. ChainFuzzer: 302/365 bugs need multi-tool.
4. **System prompt scaling** — 32 tools, ~118 chars headroom. Nearly full.
5. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
6. **Domain concentration** — ACCEPTED as partially tractable. Soft warnings
   exist. No further prompt-level intervention planned.
