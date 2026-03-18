# Improvement Thesis

Persistent strategic context for the improver. Read at start of each iteration;
update when evidence changes the picture. NOT a task list — a hypothesis to
test and refine.

## Current Hypothesis (updated iter 620)

**Feedback loop accuracy remains the dominant lever** (Pattern Watch #5,
confirmed 7×). Iter 620 fix: suite_totals collected counts from targeted test
runs (`--changed`, specific files) alongside full-suite runs, producing
nonsensical negative deltas (e.g., `3651→1179 (-2472)` for iter 619). Fixed:
correlate tool_result with originating Bash command via tool_use_id, skip
targeted runs.

**Active issues:**
1. **Depth coverage gap** — Builder did depth work 3 iterations in a row (615,
   617, 619). All found real issues. Depth-log lesson + top-neglected signal
   working well. 33 stale modules remain, 282/344 approach combos untried.
2. **Implementation efficiency** — Test reruns 8.5× avg (highest metric). Much
   of this is targeted incremental testing (good TDD), not full-suite rework.
   A targeted vs full-suite breakdown would clarify. Monitor.
3. **Composition verification** — No E2E for batch/pipe/map. Still a gap.
4. **System prompt scaling** — 32 tools, ~200 chars headroom. Nearly full.
5. **Context growth** — 56k avg, growing +3%. Not yet concerning.

**Resolved issues:**
- Suite_totals targeted-test filtering (iter 620). Both parse modes now skip
  targeted Bash test runs.
- Test delta accuracy: total-count extraction (iter 618).
- Subsystem classification: security-keyword pre-check (iter 618).
- Depth tracking accuracy: auto-detection from session data (iter 616).
- Signal accuracy: test delta false positive fixed (iter 614). Classification
  drift fixed (iter 612).
- Owner-priority alignment, research usage, domain concentration, brainstorming
  quality, web research drought, feature concentration, DESIGN.md growth,
  instruction bloat: all RESOLVED (see iter 610 thesis for details).

## Intervention History

**Archived (iters 534-596)**: 18 interventions. Key wins: BUILDER_LESSONS (534),
consumer-first editing (536, rework 76→36%), deferred reads (538, -35% context),
tool registration checklist (554, rework 72→28%), CHANGELOG archive (568),
diverge/converge brainstorming (598). Key failures: quality lesson (546),
research strategy lesson (540). See CHANGELOG archive for details.

**Recent (iters 598-616):**
- **(598)** Diverge/converge brainstorming. **STRUCTURALLY EFFECTIVE**.
- **(600)** Research-before-convergence. **VERY EFFECTIVE**: 0→21 web searches.
- **(602)** Work-type classification fix + Shannon entropy. **EFFECTIVE**.
- **(604)** Implementation analytics + build MISS fix. **EFFECTIVE**.
- **(606)** Domain signal fix + fix cycle detection fix. Domain: **INEFFECTIVE**.
- **(608)** Owner-priority brainstorming category. **EFFECTIVE** (verified 609).
- **(610)** Thesis compression 491→149 lines. **NEUTRAL** (expected).
- **(612)** Top-neglected modules in trend + classifier fix. **EFFECTIVE**:
  builder acted on neglected-modules signal in iter 615 (first depth work in
  150+ iters), found real bug, added 22 tests. Confirmed 3 iterations later.
- **(614)** Suite-total-based test delta. **CONFIRMED**: iter 615 shows accurate
  `3596→3618 (+22)` delta. No more false positives.
- **(616)** Depth tracking auto-detection from session data. **CONFIRMED**: builder
  updated depth-log.md in iter 617 (call 65). Lesson followed.
- **(618)** Test delta total-count fix + subsystem security-keyword pre-check.
  **CONFIRMED**: iter 619 trend shows accurate `+61`. Subsystem correctly
  classified as `modules/manifest`. Individual session mode had separate bug
  (fixed iter 620).
- **(620)** Suite_totals targeted-test filtering. Pending.

## Evidence (updated iter 620)

- **Iter 619 metrics**: 69 calls, $3.98, 67k ctx/turn, +61 tests, 1 fix cycle,
  46% rework, 23% re-edit. Split module-factory.ts (854L → 5 focused modules).
  Responded to top-neglected signal. No web research (acceptable for refactoring).
- **10-iter trend (601-619)**: calls avg 85, cost avg $4.10, +26.0 tests/iter.
  Context 56k avg (+3%). Re-edit 50% avg, 2.5 edits/file avg.
  Domains: 5 modules, 3 other, 2 tools. Work pattern: 6 arch, 3 feature,
  1 hardening. Diversity 82% (healthy). Test reruns 8.5× avg (includes
  targeted TDD runs — not all rework).

## Research Library

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
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
| Addy Osmani self-improving agents | Pattern imitation: agents mimic quality of existing tests. Progress logs carry knowledge between iterations. Atomic tasks with acceptance criteria. |
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

Core principles distilled from 39 interventions across 78 iterations:

1. **Data > instructions**: When you want the builder to change behavior,
   surface the data in tools it already uses (trend output). Text instructions
   in prompts are ignored without supporting data. Proven: DESIGN.md line count
   (596), domain concentration (590-592), work-type diversity (594), depth
   coverage (612→615).

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

1. **Depth coverage gap** — 34 stale modules (corrected signal). Builder did
   depth work in iter 615 for first time in 150+ iters. Depth-log lesson added,
   auto-detection active. Monitor frequency of depth work over next 3-5 iters.
   If still rare, consider making depth work outcomes more visible (bugs found,
   test coverage gaps exposed).
2. **Implementation efficiency** — Test reruns 7.5× avg, 50% re-edit. Iter 615
   proved excellent efficiency is possible (0% re-edit). Root cause may be
   scope-dependent: complex cross-cutting work inherently has more rework.
3. **GEPA-inspired structured diagnosis** — Auto-detection of waste patterns
   from execution traces. The iter 616 session-activity detection is a step
   toward this. Next: detect specific waste patterns (full-suite reruns when
   targeted would suffice, edits before reading tests).
4. **Composition verification** — No E2E for batch/pipe/map.
5. **System prompt scaling** — ~200 chars headroom at 32 tools.
