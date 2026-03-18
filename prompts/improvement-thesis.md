# Improvement Thesis

Persistent strategic context for the improver. Read at start of each iteration;
update when evidence changes the picture. NOT a task list — a hypothesis to
test and refine.

## Current Hypothesis (updated iter 632)

**Implementation quality is the next frontier.** Inspiration scan (iter 630)
partially works — iter 631 found a genuinely novel idea (blackboard) from web
research. But research depth dropped to 4 searches (lowest in 8 iters), and
the builder had no quality target beyond "tests pass." The gap has shifted from
"what to build" to "how well to build it."

**Key insight (iter 632)**: The brainstorming pipeline now has three research
stages — inspiration (Phase 1), evaluation (Phase 2.2), and implementation
(Phase 2.3). Inspiration works. Evaluation works (demo + case-making). But
implementation research is shallow when the builder feels confident. Adding
self-defined excellence criteria (AutoHarness pattern) and comparative research
(2+ approaches) to Phase 2 to raise the quality bar.

**Active issues:**
1. **Implementation quality** — Builder defines excellence criteria before
   coding + compares 2+ approaches. Verify iter 633: does the builder write
   explicit quality criteria? Does it compare trade-offs in research?
2. **Prompt-only plateau risk** — ICLR 2026 RSI: agents modifying only prompts
   plateau. Last 10 interventions have all been prompt changes. If quality
   criteria don't land, pivot to tool/scaffold expansion (parse-log.py quality
   signals, quality-review utility).
3. **Composition verification** — No E2E for batch/pipe/map.
4. **System prompt scaling** — 33 tools, ~200 chars headroom.

**Resolved issues:**
- Brainstorming creativity: inspiration scan partially effective (iter 631
  found novel blackboard idea from research). Still active but progressing.
- Owner priority drift, depth coverage, suite_totals, test delta, subsystem
  classification, depth tracking, signal accuracy, research usage, domain
  concentration, brainstorming quality, DESIGN.md growth, instruction bloat:
  all RESOLVED.

## Intervention History

**Archived (iters 534-596)**: 18 interventions. Key wins: BUILDER_LESSONS (534),
consumer-first editing (536, rework 76→36%), deferred reads (538, -35% context),
tool registration checklist (554, rework 72→28%), CHANGELOG archive (568),
diverge/converge brainstorming (598). Key failures: quality lesson (546),
research strategy lesson (540). See CHANGELOG archive for details.

**Recent (iters 598-622):**
- **(598)** Diverge/converge brainstorming. **STRUCTURALLY EFFECTIVE**.
- **(600)** Research-before-convergence. **VERY EFFECTIVE**: 0→21 web searches.
- **(602)** Work-type classification fix + Shannon entropy. **EFFECTIVE**.
- **(604)** Implementation analytics + build MISS fix. **EFFECTIVE**.
- **(606)** Domain signal fix + fix cycle detection fix. Domain: **INEFFECTIVE**.
- **(608)** Owner-priority brainstorming category. **EFFECTIVE** (verified 609).
- **(610)** Thesis compression 491→149 lines. **NEUTRAL** (expected).
- **(612)** Top-neglected in trend. **EFFECTIVE**: drove 4 depth iters (615-621).
- **(614)** Suite-total-based test delta. **CONFIRMED**.
- **(616)** Depth tracking auto-detection. **CONFIRMED**.
- **(618)** Test delta + subsystem classifier fixes. **CONFIRMED**.
- **(620)** Suite_totals targeted-test filtering. **CONFIRMED** (iter 621:
  accurate +42 delta).
- **(622)** Owner priority staleness signal in trend. **INEFFECTIVE**: builder
  saw warning but chose file-split anyway. Specificity asymmetry was root cause.
- **(624)** Per-item owner next-steps + condensed neglected list. **EFFECTIVE**:
  builder chose E2E tests (owner request) in iter 625.
- **(626)** Structured convergence with adversarial case-making. **PARTIALLY
  EFFECTIVE**: builder made explicit cases (4 vs 2 bullets), but research was
  wasted on eliminated candidate (8 searches on HTTP, 0 on chosen work).
- **(628)** Separated feasibility/evaluation/research in Phase 2. **CONFIRMED
  EFFECTIVE**: iter 629 did 12 web searches ALL on replanning (built), 0 on
  eliminated candidates. Compare iter 627: 8 on HTTP (eliminated), 0 on built.
- **(630)** Inspiration-first brainstorming + composition category + demo
  evaluation. **PARTIALLY EFFECTIVE**: iter 631 found novel blackboard idea from
  web research (3 inspiration searches). But only 4 total searches (lowest in
  8 iters). Owner-request and composition categories not genuinely engaged.
- **(632)** Quality criteria + comparative research + registration checklist
  expansion. Pending.

## Evidence (updated iter 632)

- **Iter 631 metrics**: 70 calls, $3.73, 63k ctx/turn, +36 tests, 1 fix cycle,
  57% rework (highest in 8 iters), 33% re-edit. Built shared workspace tool.
  4 web searches — 3 inspiration (found blackboard), 1 implementation (shallow).
  Externally-inspired idea confirms inspiration scan works, but research depth
  dropped significantly.
- **8-iter trend (617-631)**: calls avg 69, cost avg $3.16, +33.9 tests/iter.
  Context 51k avg (growing +9%). Re-edit 42% avg, 2.2 edits/file avg.
  Work pattern: 4 feature, 3 hardening, 1 architecture (89% diversity, healthy).
- **Quality gap identified**: Builder has no quality target beyond verification
  checks. Implementations are functional but could be deeper with explicit
  criteria. Registration rework (57%) partly due to incomplete checklist.

## Research Library

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
| Arumugam et al. (ICLR 2025) | Verbal "explore more" doesn't work; structural algorithmic changes (PSRL with 3 LLM roles) produce efficient exploration | iter 624 (specificity > priority) |
| MAST Taxonomy (NeurIPS 2025) | 14 failure modes in multi-agent systems; "unaware of termination conditions" causes work-type loops | iter 624 (depth attractor diagnosis) |
| GEPA (2507.19457, ICLR 2026 Oral) | Evolve prompts by reading full execution traces, diagnosing in natural language, proposing targeted mutations. Outperforms MIPROv2 by 10%+. Key: structured reflection on traces >> sparse scalar rewards | iter 614 (validates improver approach) |
| Factory.ai Signals | LLM-as-judge on sessions to extract abstract friction patterns. Threshold-based triggers for self-fixes. Recursive self-improvement without manual triage | iter 616 (validates auto-detection approach) |
| SICA (2504.15228) | Best-performing agent from archive becomes the meta-agent. Archive tracks utility = f(benchmark, time, cost). 17→53% on SWE-bench subset | iter 614 (archive pattern) |
| CreativeDC (2512.23601) | Diverge/converge phases prevent mode-collapse in ideation | iter 598 |
| Self-Play Information Gain (2603.02218) | Without explicit diversity tracking, self-improvement drifts to repetitive work | iter 592 |
| GVU "Second Law" (2512.02731) | Plateau → strengthen verifier, not generator | iter 548 |
| ETH Zurich AGENTS.md (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 562 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold for reasoning models | iter 564 |
| JetBrains Complexity Trap (NeurIPS 2025) | Observation masking matches LLM summarization at lower cost; hybrid gives 7-11% extra cost reduction | applied iter 523 |
| Choice-Supportive Bias (AAAI 2025) | LLMs inflate positive assessments of their initial pick; force explicit comparison with evidence before committing | iter 626 (Phase 2 restructuring) |
| DReaMAD (2503.16814) | Assigning different evaluation stances breaks conservative convergence in LLM debate/evaluation | iter 626 (adversarial case-making) |
| AutoHarness (ICLR 2026 RSI) | Agent writes own verification criteria before executing; prompt-level technique | iter 632 (quality criteria) |
| Deep Ideation (2511.02238) | Explore-expand-evolve with concept network before ideation; 10.67% quality lift over other methods | iter 630 (inspiration scan) |
| Chain of Ideas (2410.13185) | Literature chain tracing progressive development grounds better ideation than raw brainstorming | iter 630 (exploration before candidates) |
| DGM (2505.22954, Sakana) | Open-ended self-improvement via evolutionary code rewriting; growing archive of variants. Warning: objective hacking discovered | reference |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| Self-Challenging Agents (2506.01716) | Agent generates both task AND verification function (Code-as-Task); doubles success rates via self-play. Could generate test cases for untested integration paths. |
| ACON (2510.00615) | Learn compression rules from failure pairs; 26-54% memory reduction, 95%+ accuracy. When builder fails after context grows, analyze what was lost. |
| Live-SWE-agent (2511.13646) | Agent evolves own scaffolding at runtime; start minimal, create tools per-task. |
| SWE-EVO (2512.18470) | Even GPT-5 + OpenHands achieves only 21% on multi-file evolution tasks. Design for iteration, not one-shot. |
| OpenEvolve (open-source AlphaEvolve) | Dual-model ensemble: cheap for breadth, expensive for depth. Island-based architecture prevents local optima. |
| Addy Osmani / SGICE | Self-Generated In-Context Examples: store successful trajectories, feed as few-shot. 73→89-93% performance lift. Progress logs carry knowledge between iterations. |
| MPO (2503.02682, EMNLP 2025) | Meta Plan Optimization: high-level abstract plans refined iteratively beat step-level optimization. 83.1% SOTA ALFWorld/SciWorld. When stuck in local optima, raise abstraction level. |
| ICLR 2026 RSI Workshop | Agents modifying only prompts plateau quickly. Expanding to tool/scaffold code shows continued improvement. Five lenses for evaluating self-improvement. |
| HGM (Sakana AI, ICLR 2026 Oral) | Short-term benchmark optimization can kill long-term self-improvement potential. Misalignment between immediate metric gains and improvement capacity. |
| AgentDiet (2509.23586) | Trajectory compression via reflection: 40-60% input token reduction, 21-36% cost reduction with no performance loss. Identifies useless/redundant/expired information. |
| RAGEN Echo Trap | Multi-turn RL agents hit reward variance cliffs causing repetitive behavior. Fix: trajectory filtering, gradient stabilization, diverse initial states. |

### Background (validated, no current action needed)
DSPy/MIPROv2, Reflexion, Process Reward Models, Vercel eval data,
Qodo, Spotify Honk, Aider Architect/Editor, ToolComp, ToolTree, RAGEN,
CURATE, ACE, Verbalized Sampling, AlphaEvolve, Sarukkai et al.,
PromptWizard, S2R, EvolveR, EvoPrompt/DEEVO, Self-Evolving Survey,
AgentDiet, ABC-Bench, SWE-PRM, ChainFuzzer, ToolGym, ToolRLA,
ContextEvolve, CompactPrompt, SAGE, SkillRL, ReVeal, MAR, Karpathy
autoresearch, Code Knowledge Graphs, AgentCoder, CHI 2025 Artificial
Hivemind, Self-Verification Dilemma, Eco-Evolve, Meta ACH, SSR, RISE,
ITR, OpenHands SDK, LangChain Deep Agents, Anthropic harnesses blog,
Factory.ai context compression, and ~20 more.

## Improver Pattern Watch

Core principles distilled from 40 interventions across 80 iterations:

1. **Data > instructions**: When you want the builder to change behavior,
   surface the data in tools it already uses (trend output). Text instructions
   in prompts are ignored without supporting data. Proven: DESIGN.md line count
   (596), domain concentration (590-592), work-type diversity (594), depth
   coverage (612→615). **Corollary (iter 624)**: within data signals,
   specificity > priority. A concrete "Next: integration test with Ollama"
   outcompetes a vague "getting stale" warning even when the warning has
   higher urgency.

2. **Compression > addition**: Verbose context hurts execution quality (ETH
   Zurich, ~150 instruction limit). The 360→169 prompt compression improved ALL
   metrics. Natural tendency is to add; resist it.

3. **Tool-call barriers change decisions**: Extended-thinking models pre-commit
   in thinking blocks. Structural output requirements only affect post-hoc
   rationalization. To genuinely change decisions, inject new information via
   tool calls between decision phases (proven: iter 600 research injection).

4. **Know when to accept partial results**: Domain concentration chased for 7
   iterations (588→608). Signs of intractable-at-this-level problems: multiple
   approaches partially work, builder satisfies letter not spirit, root cause
   may be fundamental. At 3+ iterations on the same issue, redirect effort.

5. **Metric accuracy is load-bearing**: Five metric accuracy fixes (586: 3x
   inflation, 604: build MISS, 606: fix cycle undercount, 614: test delta,
   616: depth tracking). Each time, false signals persisted for multiple
   iterations. Validate metrics against session ground truth.

6. **Document growth is recurring**: CHANGELOG (568), BUILDER_LESSONS (562),
   DESIGN.md (596), improvement thesis (610). Any document written to every
   iteration will grow past limits. Fix: surface line count vs target in tools.

7. **Lessons work for procedures, not strategy**: Lessons in BUILDER_LESSONS
   work for procedural patterns (lint batching, consumer-first edits) but fail
   for strategic decisions. For strategic change, modify the evaluation criterion
   or inject data into the decision process.

8. **Evaluation structure > evaluation instruction**: Telling the builder to
   "compare" doesn't prevent choice-supportive bias (AAAI 2025). Structuring
   the comparison as adversarial case-making — "make the strongest case for
   each candidate over the other" — forces genuine evaluation. Similarly,
   "describe the demo" grounds abstract impact claims in concrete user outcomes.

## Strategic Priorities (for the improver, not the builder)

1. **Implementation quality** — Quality criteria (iter 632) + comparative
   research. Verify iter 633: explicit criteria in output, 2+ approaches
   researched. If this doesn't land, try tool/scaffold expansion next.
2. **Prompt-only plateau** — 10 consecutive prompt-only interventions. ICLR
   2026 RSI says this plateaus. Next non-prompt candidate: parse-log.py
   quality signals or quality-review utility for the builder.
3. **Composition verification** — No E2E for batch/pipe/map.
4. **System prompt scaling** — 33 tools, ~200 chars headroom.
