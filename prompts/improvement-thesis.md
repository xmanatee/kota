# Improvement Thesis

Persistent strategic context for the improver. Read at start of each iteration;
update when evidence changes the picture. NOT a task list — a hypothesis to
test and refine.

## Current Hypothesis (updated iter 612)

**Research is self-calibrating**: Iter 611 did 36 web searches (vs 2 in iter
609). The swing looked alarming but was actually adaptive — unfamiliar territory
(claude-agent-sdk, OpenAI format translation) warranted heavy research; familiar
refactoring (iter 609) warranted light research. No intervention needed.

**Active issues:**
1. **Depth coverage gap** — 31/44 large modules stale or never depth-reviewed.
   The builder hasn't done depth work since iter 463 (~74 iterations ago). Trend
   now surfaces top-5 neglected modules to make "Deepen existing" brainstorming
   more concrete. Monitor whether builder picks up the signal.
2. **Implementation efficiency** — Test reruns 6.0× avg (highest metric). Some
   is healthy incremental testing, but flaky `process.test.ts` wastes 2-4 calls
   per encounter. Added to BUILDER_LESSONS to reduce future investigation cost.
3. **Composition verification** — No E2E for batch/pipe/map. Still a gap.
4. **System prompt scaling** — 32 tools, ~200 chars headroom. Nearly full.

**Resolved issues:**
- Owner-priority alignment: EFFECTIVE (iter 608→609→611).
- Research usage: SELF-CALIBRATING (iter 612 analysis). 2→36 swing is adaptive.
- Domain concentration: ACCEPTED as partially tractable (iters 588→608).
- Signal accuracy: ONGOING — classification drift fixed in iter 612 (model
  client → modules/provider). Keyword classifiers need periodic refresh.
- Brainstorming quality, web research drought, feature concentration, DESIGN.md
  growth, instruction bloat: all RESOLVED (see iter 610 thesis for details).

## Intervention History

**Archived (iters 534-596)**: 18 interventions. Key wins: BUILDER_LESSONS (534),
consumer-first editing (536, rework 76→36%), deferred reads (538, -35% context),
tool registration checklist (554, rework 72→28%), CHANGELOG archive (568),
diverge/converge brainstorming (598). Key failures: quality lesson (546),
research strategy lesson (540). See CHANGELOG archive for details.

**Recent (iters 598-612):**
- **(598)** Diverge/converge brainstorming. **STRUCTURALLY EFFECTIVE**.
- **(600)** Research-before-convergence. **VERY EFFECTIVE**: 0→21 web searches.
- **(602)** Work-type classification fix + Shannon entropy. **EFFECTIVE**.
- **(604)** Implementation analytics + build MISS fix. **EFFECTIVE**.
- **(606)** Domain signal fix + fix cycle detection fix. Domain: **INEFFECTIVE**.
- **(608)** Owner-priority brainstorming category. **EFFECTIVE** (verified 609).
- **(610)** Thesis compression 491→149 lines. **NEUTRAL** (expected).
- **(612)** Top-neglected modules in trend + classifier fix. Pending verification.

## Evidence (updated iter 612)

- **Iter 611 metrics**: 96 calls, $5.11, 59k ctx/turn, +36 tests, 0 fix cycles,
  30% rework, 33% re-edit, 36 web searches. Built OpenAIModelClient with
  extensive research (3 Agent subprocesses). Research was productive: discovered
  claude-agent-sdk is incompatible, pivoted to OpenAI-compatible approach.
- **8-iter trend (597-611)**: calls avg 94, cost avg $4.34, +21.2 tests/iter.
  Context 58k avg (growing +4%). Re-edit 54% avg, 2.4 edits/file avg.
  Domains: 4 tools, 3 modules, 1 other. Work pattern: 6 arch, 2 feature
  — diversity 51% (moderately concentrated).

## Research Library

### Actively Informing Strategy
| Paper | Key Insight | Applied |
|---|---|---|
| CreativeDC (2512.23601) | Diverge/converge phases prevent mode-collapse in ideation | iter 598 |
| CHI 2025 Artificial Hivemind | RLHF-aligned LLMs converge toward average; repeated assistance decreases originality | iter 598 |
| Self-Play Information Gain (2603.02218) | Without explicit diversity tracking, self-improvement drifts to repetitive work | iter 592 |
| GVU "Second Law" (2512.02731) | Plateau → strengthen verifier, not generator | iter 548 |
| ETH Zurich AGENTS.md (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 562 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold for reasoning models | iter 564 |
| Self-Verification Dilemma (2602.03485) | LLMs waste computation on confirmatory rechecks; experience-driven suppression reduces tokens 20% without accuracy loss | NEW |
| Eco-Evolve (dual-process) | System 1 (fast generation) + System 2 (dedicated critic): +26.6% on SWE-bench Verified | NEW |

### Potential Future Directions
| Paper | Opportunity |
|---|---|
| Live-SWE-agent (2511.13646) | Agent evolves own scaffolding at runtime; 77.4% SWE-bench Verified — outperforms all manually crafted agents |
| Meta ACH / Mutation-Guided Testing (FSE 2025) | LLM-generated mutants + test generation; 73% acceptance rate at Meta scale |
| SSR Self-play SWE-RL (2512.18552) | Bug injection → resolution self-play; +10.4 on SWE-bench Verified without human labels |
| Self-Challenging Agents (NeurIPS 2025) | Challenger creates tasks, executor solves them; doubles tool-use benchmark performance |
| RISE Recursive Introspection (NeurIPS 2024) | Multi-turn self-correction; 17-24% improvement over 5 introspection turns |
| ITR (2602.17046) | Per-step retrieval of prompt fragments + tools; 95% context reduction |
| SICA (2504.15228) | Agent reviews own performance, edits own code/prompts (17→53%) |

### Background (validated, no current action needed)
DSPy/MIPROv2, Reflexion, GEPA, Process Reward Models, Vercel eval data,
Qodo, Spotify Honk, Aider Architect/Editor, ToolComp, ToolTree, RAGEN,
CURATE, ACE, Verbalized Sampling, AlphaEvolve, Sarukkai et al.,
PromptWizard, S2R, EvolveR, EvoPrompt/DEEVO, Self-Evolving Survey,
AgentDiet, ABC-Bench, SWE-PRM, ChainFuzzer, ToolGym, ToolRLA, ACON,
ContextEvolve, CompactPrompt, SAGE, SkillRL, ReVeal, SWE-EVO, MAR,
Karpathy autoresearch, Code Knowledge Graphs, AgentCoder, and ~30 more.

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

1. **Depth coverage gap** — 31 stale modules, no depth work since iter 463.
   Iter 612 surfaced top-neglected modules in trend. Monitor whether builder
   picks up the signal in iter 613+. If not after 2-3 iters, consider
   strengthening the "Deepen existing" category guidance.
2. **Implementation efficiency** — Test reruns 6.0× avg. Flaky test lesson
   added (iter 612). Monitor for reduction. Self-Verification Dilemma research
   suggests targeted verification > blanket reruns.
3. **Composition verification** — No E2E for batch/pipe/map. Gap persists.
4. **System prompt scaling** — ~200 chars headroom at 32 tools. Will become
   blocking if builder adds more tools.
5. **Classifier drift** — Keyword-based subsystem classifier needs periodic
   refresh as new work types emerge (Pattern Watch #5). Fixed in iter 612
   for model-client work.
