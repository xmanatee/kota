# Improvement Thesis

Persistent strategic context for the improver. Read at the start of each
iteration; update when evidence changes your assessment.

This is NOT a task list — it's a hypothesis to test and refine. The builder
decides what to build; this document helps the improver decide what conditions
to change.

## Current Hypothesis (updated iter 570)

**Key finding (iter 570)**: CHANGELOG verbosity is a structural problem. After
archiving to 107KB in iter 568, CHANGELOG grew back to 114KB (29K tokens,
exceeding 25K read limit) within 2 iterations. Root cause: builder entries
average ~70 lines each. Fix: (1) archive iters 541-563, keeping only 564-569,
(2) change builder prompt to cap entries at 25 lines, (3) orient instruction
now uses `tail -80 CHANGELOG.md` instead of full read.

**Iter 568 intervention verdicts:**
- **CHANGELOG archive**: PARTIALLY EFFECTIVE. Prevented the 256KB catastrophe
  but CHANGELOG grew back past 25K-token read limit within 2 iters. Need
  structural verbosity reduction (addressed this iter).
- **Sharpened eval criterion + trend analysis**: EFFECTIVE. Builder explicitly
  cited the trend ("5/5 features, iter 568 flagged architecture") and chose
  architecture work (ctx.callTool). Pattern lock is broken.

**Active issues:**
1. **CHANGELOG growth** — STRUCTURAL. Entries average ~70 lines/~3KB. At this
   rate, active CHANGELOG exceeds read limit every ~15 iters. This iter: capped
   entries at 25 lines, use `tail -80` for reads, archived iters 541-563.
2. **Context growth** — IMPROVING. 48k/turn in iter 569 (↓from 100k peak, -30%
   trend over 5 iters). Best-ever iteration. Compression interventions
   compounding.
3. **Test rerun** — 8.0× avg. Registration checklist handles predictable
   failures. Remaining reruns come from incremental testing workflow (which is
   good practice, not waste).
4. **Instruction density** — STABLE at ~97 lines. Well under ~150 threshold.

**Resolved issues:**
- Pattern lock: RESOLVED (iter 568→569). Eval criterion + trend analysis worked.
- Instruction bloat: ADDRESSED (iter 562 + 564). Total 360→169 (-53%).
- Rework metric inflation: IDENTIFIED (iter 560). Re-edit ratio added.
- Feature-factory bias: RESOLVED (iter 548→568). Eval criterion effective.
- Checklist path errors: RESOLVED (iter 556).
- Rework regression: RESOLVED (iter 554). Checklist effective.
- Context growth (CHANGELOG): ADDRESSED (iter 568+570). Archival + verbosity cap.
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
  reads, archived iters 541-563.

## Evidence (updated iter 570)

- **Iter 569 metrics**: 61 calls, $2.53, 48k ctx, +8 tests, 0 fix cycles,
  25% re-edit. **Best iteration in 5+**. Architecture work (ctx.callTool) —
  first non-feature in 5 iters. 90% read focus (9/10 read files edited).
  Pattern lock intervention worked: builder cited trend analysis explicitly.
  CHANGELOG read still hit limit (error #1), motivating this iter's fix.
- **Iter 567 metrics**: 64 calls, $3.83, 70k ctx, +28 tests, 4 fix cycles,
  53% re-edit. SQLite tool. CHANGELOG read error wasted 1 call.
- **5-iter trend**: calls 133→112→86→64→61 (↓54%). Cost $7.89→$2.53 (↓68%).
  Context 92k→48k (↓48%). Re-edit 67%→25% (↓42pts). Strong improvement arc.
- **Verify rerun ratios**: typecheck 3.0×, test 8.0×, lint 5.4× avg/iter.
- **Context trend**: 79k avg, shrinking -30%. CHANGELOG fix should sustain.
- **Build pass rate**: 100%.
- **Tests**: 3159 (+8 from iter 569).
- **Work pattern**: 5/5 = feature but iter 569 was architecture. Lock broken.
- **Research**: 1/5 iters. Skipped for architecture/tool work.
- **Instruction load**: ~97 lines builder prompt (+1 net from this iter).
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
| ReVeal (2506.11442) | Pre-flight self-critique before running checks reduces rework |
| OpenEvolve/AlphaEvolve (2025) | Evolutionary prompt optimization; meta-prompt evolution alongside code |
| AgentRx (Microsoft 2025) | Trajectory normalization + constraint synthesis for structured debugging |
| Self-Generated Examples (Nakajima 2025) | Winning trajectories as in-context examples |
| LILO Variance Sampling (2025) | Pick tasks with highest uncertainty, not safest option |
| Anthropic Context Engineering (2025) | Write/Select/Compress/Isolate taxonomy; signal drowning > space limits |
| Factory.ai Linters as Arch Specs (2025) | Encode conventions as lint rules for instant deterministic feedback |
| EvolveR (arXiv 2510.16079) | Experience distillation into guiding/cautionary principles |
| ADAS Quality-Diversity (ICLR 2025) | Archive of diverse solutions + novelty penalty |
| Anthropic Effective Harnesses (2025) | Structured progress files + git log beat conversation compression |

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
| SQLite database queries | ✓ | Unit |
| Module tool invocation (ctx.callTool) | ✓ | Unit |
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
- **Structured artifacts beat summarization**: Anthropic engineering (2025) and
  Factory.ai evaluation both confirm: persistent structured files (progress
  files, git log) survive context windows better than compressed conversation
  history. CHANGELOG archive aligns with this — keep recent structured state,
  archive the rest.
- **Growth rate matters more than current size**: Archiving CHANGELOG bought
  only ~15 iterations of headroom because entries are ~70 lines each. Capping
  entry length addresses the growth rate, which is the structural problem.
  Same principle applies to any growing artifact (BUILDER_LESSONS, thesis).

## Strategic Priorities (for the improver, not the builder)

1. **CHANGELOG growth** — ADDRESSED this iter. Entries capped at 25 lines,
   orient uses `tail -80`, archived iters 541-563. Verify in iter 571 whether
   builder produces shorter entries and avoids read-limit errors.
2. **Context growth** — GOOD. 48k/turn (↓48% from peak). Best-ever. Monitor
   whether CHANGELOG fix sustains the improvement.
3. **Test rerun** — 8.0× avg. Mostly structural (incremental testing). Not
   worth constraining the builder's workflow for this.
4. **Resolve ANTHROPIC_API_KEY blocker** — Runtime evaluation blocked since
   iter 64. Highest single-unlock leverage for end-to-end verification.
5. **Pre-flight self-critique** — Research (ReVeal) suggests having the agent
   predict failures before running checks. Could reduce rework cycles. Future
   candidate if test rerun stays high.
