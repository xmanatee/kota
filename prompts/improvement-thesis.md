# Improvement Thesis

Persistent strategic context for the improver. Read at start of each iteration;
update when evidence changes the picture. NOT a task list — a hypothesis to
test and refine.

## Current Hypothesis (updated iter 614)

**Metric accuracy continues to be load-bearing** (Pattern Watch #5, now
confirmed 4×). Test delta extraction gave a false +0 for iter 613 because
"0 new test failures" matched the regex. Fixed by extracting actual suite
totals from test run output — far more reliable than text-pattern matching.
Iter 613 actually produced +22 tests (3580→3602).

**Active issues:**
1. **Depth coverage gap** — 31/44 large modules stale or never depth-reviewed.
   Builder hasn't done depth work since iter 463 (~150 iterations ago). Iter 613
   continued multi-provider (owner request) despite neglected-modules signal.
   Expected — the owner request took priority. Monitor iter 615.
2. **Implementation efficiency** — Test reruns 7.0× avg (highest metric). Partly
   structural (3600+ tests), partly flaky tests, partly avoidable rework (iter
   613: 3 fix cycles from not reading test files before breaking changes).
3. **Composition verification** — No E2E for batch/pipe/map. Still a gap.
4. **System prompt scaling** — 32 tools, ~200 chars headroom. Nearly full.
5. **Context growth** — 55k avg, growing +24%. May be driven by codebase growth.

**Resolved issues:**
- Signal accuracy: test delta false positive fixed (iter 614). Suite totals now
  primary source. Classification drift fixed (iter 612).
- Owner-priority alignment, research usage, domain concentration, brainstorming
  quality, web research drought, feature concentration, DESIGN.md growth,
  instruction bloat: all RESOLVED (see iter 610 thesis for details).

## Intervention History

**Archived (iters 534-596)**: 18 interventions. Key wins: BUILDER_LESSONS (534),
consumer-first editing (536, rework 76→36%), deferred reads (538, -35% context),
tool registration checklist (554, rework 72→28%), CHANGELOG archive (568),
diverge/converge brainstorming (598). Key failures: quality lesson (546),
research strategy lesson (540). See CHANGELOG archive for details.

**Recent (iters 598-614):**
- **(598)** Diverge/converge brainstorming. **STRUCTURALLY EFFECTIVE**.
- **(600)** Research-before-convergence. **VERY EFFECTIVE**: 0→21 web searches.
- **(602)** Work-type classification fix + Shannon entropy. **EFFECTIVE**.
- **(604)** Implementation analytics + build MISS fix. **EFFECTIVE**.
- **(606)** Domain signal fix + fix cycle detection fix. Domain: **INEFFECTIVE**.
- **(608)** Owner-priority brainstorming category. **EFFECTIVE** (verified 609).
- **(610)** Thesis compression 491→149 lines. **NEUTRAL** (expected).
- **(612)** Top-neglected modules in trend + classifier fix. **PARTIALLY
  EFFECTIVE**: classifier fix confirmed; neglected-modules signal not acted on
  (builder was finishing owner-requested multi-provider work). Pending 1 more iter.
- **(614)** Suite-total-based test delta + thesis research update. Pending.

## Evidence (updated iter 614)

- **Iter 613 metrics**: 95 calls, $4.40, 61k ctx/turn, +22 tests (3580→3602),
  3 fix cycles, 45% rework, 71% re-edit. Completed multi-provider CLI wiring
  (owner request). Fix cycles from not reading cli.test.ts before removing
  ensureApiKey — cross-cutting lesson exists but was applied too late.
- **8-iter trend (599-613)**: calls avg 94, cost avg $4.20, +21.4 tests/iter.
  Context 55k avg (growing +24%). Re-edit 56% avg, 2.6 edits/file avg.
  Domains: 4 modules, 3 tools, 1 other. Work pattern: 6 arch, 2 feature.

## Research Library

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
| GEPA (2507.19457, ICLR 2026 Oral) | Evolve prompts by reading full execution traces, diagnosing in natural language, proposing targeted mutations. Outperforms MIPROv2 by 10%+. Key: structured reflection on traces >> sparse scalar rewards | iter 614 (validates improver approach) |
| SICA (2504.15228) | Best-performing agent from archive becomes the meta-agent. Archive tracks utility = f(benchmark, time, cost). 17→53% on SWE-bench subset | iter 614 (archive pattern) |
| CreativeDC (2512.23601) | Diverge/converge phases prevent mode-collapse in ideation | iter 598 |
| Self-Play Information Gain (2603.02218) | Without explicit diversity tracking, self-improvement drifts to repetitive work | iter 592 |
| GVU "Second Law" (2512.02731) | Plateau → strengthen verifier, not generator | iter 548 |
| ETH Zurich AGENTS.md (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 562 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold for reasoning models | iter 564 |
| Anthropic harnesses blog | Initializer agent + progress file for session handoff; separate first-window prompt from continuation prompts | NEW |
| Factory.ai context compression | Per-tool-type summarizers (50-200 chars); structured > unstructured compression | NEW |
| JetBrains Complexity Trap (NeurIPS 2025) | Observation masking matches LLM summarization at lower cost; hybrid gives 7-11% extra cost reduction | applied iter 523 |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| Self-Challenging Agents (2506.01716) | Agent generates both task AND verification function (Code-as-Task); doubles success rates via self-play. Could generate test cases for untested integration paths. |
| ACON (2510.00615) | Learn compression rules from failure pairs; 26-54% memory reduction, 95%+ accuracy. When builder fails after context grows, analyze what was lost. |
| Live-SWE-agent (2511.13646) | Agent evolves own scaffolding at runtime; start minimal, create tools per-task. |
| SWE-EVO (2512.18470) | Even GPT-5 + OpenHands achieves only 21% on multi-file evolution tasks. Design for iteration, not one-shot. |
| OpenEvolve (open-source AlphaEvolve) | Dual-model ensemble: cheap for breadth, expensive for depth. Island-based architecture prevents local optima. |

### Background (validated, no current action needed)
DSPy/MIPROv2, Reflexion, Process Reward Models, Vercel eval data,
Qodo, Spotify Honk, Aider Architect/Editor, ToolComp, ToolTree, RAGEN,
CURATE, ACE, Verbalized Sampling, AlphaEvolve, Sarukkai et al.,
PromptWizard, S2R, EvolveR, EvoPrompt/DEEVO, Self-Evolving Survey,
AgentDiet, ABC-Bench, SWE-PRM, ChainFuzzer, ToolGym, ToolRLA,
ContextEvolve, CompactPrompt, SAGE, SkillRL, ReVeal, MAR, Karpathy
autoresearch, Code Knowledge Graphs, AgentCoder, CHI 2025 Artificial
Hivemind, Self-Verification Dilemma, Eco-Evolve, Meta ACH, SSR, RISE,
ITR, OpenHands SDK, LangChain Deep Agents, and ~20 more.

## Improver Pattern Watch

Core principles distilled from 38 interventions across 76 iterations:

1. **Data > instructions**: When you want the builder to change behavior,
   surface the data in tools it already uses (trend output). Text instructions
   in prompts are ignored without supporting data. Proven: DESIGN.md line count
   (596), domain concentration (590-592), work-type diversity (594).

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

5. **Metric accuracy is load-bearing**: Three metric accuracy fixes (586: 3x
   inflation, 604: build MISS, 606: fix cycle undercount). Each time, false
   signals persisted for multiple iterations. Validate metrics against session
   ground truth. Keyword-based classification drifts and needs periodic refresh.

6. **Document growth is recurring**: CHANGELOG (568), BUILDER_LESSONS (562),
   DESIGN.md (596), improvement thesis (610). Any document written to every
   iteration will grow past limits. Fix: surface line count vs target in tools.

7. **Lessons work for procedures, not strategy**: Lessons in BUILDER_LESSONS
   work for procedural patterns (lint batching, consumer-first edits) but fail
   for strategic decisions. For strategic change, modify the evaluation criterion
   or inject data into the decision process.

## Strategic Priorities (for the improver, not the builder)

1. **Depth coverage gap** — 31 stale modules, no depth work since iter 463
   (~150 iters ago). Neglected-modules signal in trend since iter 612. Builder
   continued owner request in 613. If not acted on by iter 617, consider
   strengthening the "Deepen existing" category.
2. **Implementation efficiency** — Test reruns 7.0× avg, 56% re-edit. The
   GEPA insight suggests: rather than adding lessons (which don't change
   strategic behavior), improve the diagnostic data the improver uses to
   identify waste patterns. Suite-total-based delta (iter 614) is a step.
3. **GEPA-inspired prompt evolution** — GEPA formalizes what the improver
   does: read execution traces, diagnose, propose targeted mutations. The
   loop already does this informally. Opportunity: make diagnosis more
   structured (parse-log.py auto-detection of waste patterns).
4. **Composition verification** — No E2E for batch/pipe/map.
5. **System prompt scaling** — ~200 chars headroom at 32 tools.
6. **Context growth** — 55k avg, +24%. Monitor whether this plateaus as
   multi-provider work completes (reading unfamiliar code inflates context).
