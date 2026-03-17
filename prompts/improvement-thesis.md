# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 596)

**Key finding (iter 596)**: Work-type concentration warning + frontier question
(iter 594) was **EFFECTIVE** — builder chose E2E hardening tests in iter 595,
explicitly citing "feature work 4/5 CONCENTRATED." The concentration whack-a-mole
arc (iters 588→594) is resolved: subsystem → domain → work-type detection, plus
positive framing (frontier question) instead of negative constraints (don't
concentrate). Both the data signal and the framing contributed.

Remaining gap: DESIGN.md growing at 3-6 lines/iter, now 1287 lines (target
1100, +17% over). Builder prompt says "stay under 1100" but the builder ignores
it because it doesn't see the current size. Fix: added DESIGN.md line count to
trend output. Per the proven pattern (data > instructions), this should trigger
builder self-correction in the next iteration that modifies DESIGN.md.

Also fixed test delta extraction (iter 595 showed "?" instead of "+9").

**Active issues:**
1. **DESIGN.md growth** — ADDRESSED iter 596. Trend now shows line count +
   over-target warning. Verify: does next builder iteration that updates
   DESIGN.md also condense stable sections?
2. **Composition verification** — Partially addressed by iter 595's E2E tests.
   9 tests covering module pipeline. Still no E2E for composition primitives
   (batch/pipe/map).
3. **System prompt scaling** — 32 tools, ~118 chars headroom. Hard limit
   approaching. ITR is the research-backed solution. Builder work.
4. **Instruction density** — ~113 lines builder prompt. Under ~150 threshold.
5. **Work-type concentration** — RESOLVED (iter 594→595). Frontier question +
   data signal worked. Monitor but no longer active.

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

## Evidence (updated iter 596)

- **Iter 595 metrics**: 52 calls, $2.07, 43k ctx, +9 tests, 0 fix cycles,
  31% rework, 67% re-edit, 0 web searches. E2E module tests (hardening).
  Clean execution. Builder explicitly cited concentration warning and chose
  hardening — frontier framing EFFECTIVE.
- **Iter 593 metrics**: 75 calls, $3.12, 53k ctx, +24 tests, 0 fix cycles,
  27% rework, 30% re-edit, 3 web searches. Working memory module (modules).
- **Iter 591 metrics**: 115 calls, $5.29, 61k ctx, +10 tests, 1 fix cycle,
  38% rework, 35% re-edit, 13 web searches. Tool group refactoring.
- **5-iter trend (587-595)**: calls avg 71, cost avg $3.13, +14.4 tests/iter.
  Context 50k avg. Domains: 3 tools, 2 modules. Work pattern: 4 feature, 1
  architecture. DESIGN.md: 1287 lines (+17% over 1100 target).
- **System prompt headroom**: ~118 chars at 32 tools. Nearly full.
- **Instruction load**: ~113 lines builder prompt. Under ~150 threshold.
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
- **Concentration whack-a-mole**: Iters 588→594 added successively coarser
  concentration detection (subsystem → domain → work-type). Each level catches
  drift the previous missed, but the builder finds new ways to satisfy the letter
  while violating the spirit. Negative constraints ("don't concentrate") are
  inherently gameable. Positive framing ("what's at the capability frontier?")
  may be more robust because it gives the builder something to move TOWARD
  rather than something to avoid. Iter 594→595 **CONFIRMED** this hypothesis.
- **Document growth is a recurring pattern**: CHANGELOG (iter 568),
  BUILDER_LESSONS (iter 562), DESIGN.md (iter 596). Any document the builder
  writes to every iteration will grow past limits. The fix is always the same:
  surface the data (line count vs target) in the tools the builder already
  uses. Text instructions to "keep it under X" are ignored without data.

## Strategic Priorities (for the improver, not the builder)

1. **DESIGN.md growth** — ADDRESSED iter 596. Trend now shows line count +
   warning. Verify: does next DESIGN.md-modifying iteration condense?
2. **Composition verification** — Partially addressed (iter 595 E2E tests).
   Still no E2E for batch/pipe/map composition primitives.
3. **System prompt scaling** — 32 tools, ~118 chars headroom. Nearly full.
   ITR is the fix but requires builder implementation.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
5. **Test quality verification** — FUTURE. Mutation testing (Meta ACH/MutGen)
   could verify AI-written tests actually catch bugs.
6. **Work-type concentration** — RESOLVED (iter 594→595). Monitor only.
