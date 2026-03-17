# Improvement Thesis

Persistent strategic context for the improver. Read at start of each iteration;
update when evidence changes the picture. NOT a task list — a hypothesis to
test and refine.

## Current Hypothesis (updated iter 610)

**Owner-priority alignment: VERIFIED EFFECTIVE (iter 609)**. The "Owner
request" brainstorming category (iter 608) worked — builder generated an owner
request candidate and chose it (ModelClient abstraction for dual SDK support).
This was the first time in 10+ iterations the builder directly addressed a
NOTES.md `b:` item. Continue monitoring in 611-613.

**Active issues:**
1. **Research usage declining** — Web searches: 21→23→19→5→2 over iters 601-609.
   The Phase 2 instruction works but builder does the minimum (2 searches for
   2 candidates). Quality was fine in 609 (targeted SDK search) but the trend
   suggests research is becoming a checkbox. Monitor.
2. **Implementation efficiency** — Verify reruns still elevated: test 5.5×,
   lint 4.1× avg. But re-edit dropped to 67% with only 28% rework in 609,
   suggesting the high re-edit was planned cross-cutting work, not failed edits.
   The metric may overstate the problem.
3. **Composition verification** — No E2E for batch/pipe/map. Still a gap.
4. **System prompt scaling** — 32 tools, ~118 chars headroom. Nearly full.

**Resolved issues:**
- Owner-priority alignment: EFFECTIVE (iter 608→609).
- Domain concentration: ACCEPTED as partially tractable (iters 588→608).
- Brainstorming quality: RESOLVED (iters 598→602).
- Web research drought: RESOLVED (iter 600).
- Signal accuracy: RESOLVED (iters 586→606).
- Feature concentration: RESOLVED (iters 594→602).
- DESIGN.md growth: RESOLVED (iter 596). Currently 904 lines (healthy).
- Instruction bloat: RESOLVED (builder prompt 184→94→98 lines).

## Intervention History

**Archived (iters 534-596)**: 18 interventions. Key wins: BUILDER_LESSONS (534),
consumer-first editing (536, rework 76→36%), deferred reads (538, -35% context),
tool registration checklist (554, rework 72→28%), CHANGELOG archive (568),
diverge/converge brainstorming (598). Key failures: quality lesson (546),
research strategy lesson (540). See CHANGELOG archive for details.

**Recent (iters 598-608):**
- **(598)** Diverge/converge brainstorming. **STRUCTURALLY EFFECTIVE** but
  substantively hollow — builder pre-decided, wrote post-hoc labels.
- **(600)** Research-before-convergence. **VERY EFFECTIVE**: 0→21 web searches.
  Tool-call barrier between diverge and converge blocks thinking-block bypass.
- **(602)** Work-type classification fix + Shannon entropy. **EFFECTIVE**.
- **(604)** Implementation analytics + build MISS fix. **EFFECTIVE**.
- **(606)** Domain signal fix + fix cycle detection fix. Domain: **INEFFECTIVE**.
  Fix cycles: **CONFIRMED**.
- **(608)** Owner-priority brainstorming category. **EFFECTIVE** (verified 609):
  builder generated owner-request candidate, chose it, built ModelClient.

## Evidence (updated iter 610)

- **Iter 609 metrics**: 103 calls, $4.35, 53k ctx/turn, +9 tests, 1 fix cycle,
  28% rework, 67% re-edit, 2 web searches. Clean ModelClient refactor touching
  12 files. Builder followed cross-cutting discipline (grep consumers first).
- **8-iter trend (595-609)**: calls avg 88, cost avg $3.96, +17.9 tests/iter.
  Context 56k avg (shrinking -3%). Re-edit 58% avg, 2.6 edits/file avg.
  Domains: 5/8 tools CONCENTRATED. Work pattern: 6 arch, 1 hardening, 1 feature
  — diversity 67% (healthy).

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
| ITR (2602.17046) | Per-step retrieval of prompt fragments + tools; 95% context reduction |
| SICA (2504.15228) | Agent reviews own performance, edits own code/prompts (17→53%) |
| OpenEvolve/AlphaEvolve | Evolutionary prompt optimization; meta-prompt evolution alongside code |
| Self-Challenging Agents (NeurIPS 2025) | Challenger creates tasks, executor solves them; doubles tool-use benchmark performance |
| Factory.ai Linters as Arch Specs | Encode conventions as lint rules for instant deterministic feedback |

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

1. **Research quality maintenance** — Usage declining (21→2). Monitor whether
   this affects work selection quality. If builder starts making uninformed
   choices, strengthen the Phase 2 research requirement.
2. **Implementation efficiency** — Verify reruns elevated but may be overstated.
   Self-Verification Dilemma research suggests targeted verification > blanket
   reruns. Low priority unless rework% increases.
3. **Composition verification** — No E2E for batch/pipe/map. Gap exists but
   builder may address organically.
4. **System prompt scaling** — ~118 chars headroom at 32 tools. Will become
   blocking if builder adds more tools.
5. **Thesis/document hygiene** — This compression (491→~160 lines) is the
   first application of Pattern Watch #6 to the thesis itself.
