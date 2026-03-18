# Improvement Thesis

Persistent strategic context for the improver. Read at start of each iteration;
update when evidence changes the picture. NOT a task list — a hypothesis to
test and refine.

## Current Hypothesis (updated iter 624)

**Specificity asymmetry** is the root cause of owner-priority drift. The iter
622 staleness warning was visible but ignored (builder saw it, chose split
anyway). The top-neglected list provides specific, risk-free candidates;
owner requests were vague. Fix: per-item "Next:" steps in trend output, owner
section moved above neglected, neglected condensed 5→2 when stale.

**Key insight**: Data signals compete on specificity. A concrete "Next:
integration test with Ollama" beats a vague "getting stale" warning even when
the vague one is higher priority. This extends principle #1 (data > instructions)
— within data, specificity > priority.

**Active issues:**
1. **Owner priority drift** — 5 pending `b:` items, last progress iter 613
   (5 builder iters ago, 3 consecutive file-splits). Iter 624 added per-item
   next-steps and condensed top-neglected. Verify: does builder pick owner
   request in iter 625?
2. **Implementation efficiency** — Test reruns 8.7× avg. Includes targeted TDD
   runs (healthy). Monitor.
3. **Composition verification** — No E2E for batch/pipe/map.
4. **System prompt scaling** — 32 tools, ~200 chars headroom.

**Resolved issues:**
- Depth coverage gap: 4 depth iters (615-621), now balanced by owner-priority
  signal. Top-neglected list condensed when stale.
- Suite_totals, test delta, subsystem classification, depth tracking, signal
  accuracy, owner-priority alignment (prompt-level), research usage, domain
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
- **(624)** Per-item owner next-steps + condensed neglected list. Pending.

## Evidence (updated iter 624)

- **Iter 623 metrics**: 72 calls, $3.02, 42k ctx/turn, +25 tests, 0 fix cycles,
  38% rework, 33% re-edit. Split module-factory.ts. 3rd consecutive file-split.
- **10-iter trend (605-623)**: calls avg 81, cost avg $3.86, +28 tests/iter.
  Context 54k avg (shrinking -16%). Re-edit 39% avg, 2.0 edits/file avg.
  Domains: 5 modules, 3 tools, 2 other. Builder iters since owner progress: 5.
  **Key concern**: top-neglected specificity was outcompeting owner priorities.
  Now addressed with per-item next-steps.

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

## Strategic Priorities (for the improver, not the builder)

1. **Owner priority drift** — Iter 624 added per-item next-steps and condensed
   neglected 5→2. If builder still doesn't pick owner request in iter 625,
   escalate: consider making "Owner request" category mandatory in convergence
   (must evaluate at least one owner item in Phase 2).
2. **SGICE trajectory replay** — Research finding: 73→93% lift from feeding
   successful trajectories as few-shot examples. Practical opportunity: store
   high-scoring session summaries (low cost, 0% re-edit) and inject during
   brainstorming for similar work types.
3. **Composition verification** — No E2E for batch/pipe/map.
4. **System prompt scaling** — ~200 chars headroom at 32 tools.
