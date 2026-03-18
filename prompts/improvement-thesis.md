# Improvement Thesis

Persistent strategic context for the improver. Read at start of each iteration;
update when evidence changes the picture. NOT a task list — a hypothesis to
test and refine.

## Current Hypothesis (updated iter 626)

**Choice-supportive bias** limits decision quality. The builder picks early in
its thinking and rationalizes post-hoc (AAAI 2025). Phase 2 said "evaluate side
by side" but didn't structure the comparison to prevent early commitment. Fix:
require explicit case-making for each candidate before committing, with a
"describe the user impact" heuristic that grounds evaluation in outcomes.

**Key insight (iter 624, confirmed)**: Data signals compete on specificity.
Per-item next-steps fixed owner-priority drift. **New insight (iter 626)**:
evaluation structure > evaluation instruction. Telling the builder to "compare"
doesn't work; structuring the comparison as adversarial case-making does
(DReaMAD, AAAI 2025 choice-supportive bias research).

**Active issues:**
1. **Decision quality** — Builder gravitates to safe/easy-to-decide work when
   not steered by data. Iter 626 restructured Phase 2 to counter
   choice-supportive bias. Verify: does iter 627 show genuine comparison?
2. **Composition verification** — No E2E for batch/pipe/map.
3. **System prompt scaling** — 32 tools, ~200 chars headroom.

**Resolved issues:**
- Owner priority drift: per-item next-steps (624) fixed it. Iter 625 chose
  E2E tests (owner request). 0 builder iters since last progress.
- Depth coverage, suite_totals, test delta, subsystem classification, depth
  tracking, signal accuracy, research usage, domain concentration,
  brainstorming quality, DESIGN.md growth, instruction bloat: all RESOLVED.

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
- **(626)** Structured convergence with adversarial case-making. Pending.

## Evidence (updated iter 626)

- **Iter 625 metrics**: 75 calls, $2.78, 55k ctx/turn, +11 tests, 1 fix cycle,
  33% rework, 75% re-edit. E2E tests for delegate/architect/scheduled actions.
  Chose owner request (E2E testing). 0 web research calls (expected for test work).
- **8-iter trend (611-625)**: calls avg 76, cost avg $3.54, +30.6 tests/iter.
  Context 53k avg (shrinking -5%). Re-edit 39% avg, 2.2 edits/file avg.
  Work pattern: 3 feature, 3 hardening, 2 architecture (healthy diversity).
  Owner priorities: 0 builder iters since last progress. **Resolved**.
- **Decision quality concern**: 3/8 iters had 0 web research (file splits, tests).
  Research correlates with ambitious work (r≈0.7 across recent iters). Phase 2
  restructuring should encourage research even for seemingly-obvious candidates.

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
| AutoHarness (ICLR 2026 RSI) | Agent writes own verification criteria before executing; prompt-level technique | potential |

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

1. **Decision quality** — Iter 626 restructured Phase 2 with adversarial
   case-making. Verify in iter 627: does the builder genuinely compare
   candidates, or does it still pick-then-rationalize?
2. **Context engineering** — Loading examples of successful ambitious iterations
   is more effective than instructions (AAAI 2025, context engineering research).
   Practical next step: if Phase 2 restructuring alone isn't enough, inject
   a "best recent iteration" example into brainstorming context.
3. **Composition verification** — No E2E for batch/pipe/map.
4. **System prompt scaling** — ~200 chars headroom at 32 tools.
