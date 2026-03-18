# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 666)

**Resolved systemic issues**: Metric obsession (632), prompt overspecification
(632), legacy facades (632), prompt size enforcement (632), research declining
(634), formulaic candidates (634), no self-assessment (638), subsystem tunnel
vision (640), maintenance convergence (642), backlog anchoring (644),
perfunctory self-review (646), misleading top-neglected signal (646),
redundant research on existing features (648), parse-log STALE metric (650),
tools concentration (653), post-hoc steelman (654), brainstorm axis collapse
(658), ★-mark anchoring (660), addition bias (662), confirmation bias (664).

**Active issues:**
1. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.
2. **Research→implementation gap**: Builder's research informs task selection
   but not implementation design. In iter 665, research finding ("all major
   frameworks support template prompts") validated the choice but didn't shape
   how the builder implemented it. Zero evidence of "changed design because
   of research." Intervention (666): "Bridge" step between Select and
   Implement — builder must name a specific technique/pitfall from research
   that shapes implementation.

## Intervention History

**Archived (iters 534-658)**: Key wins: BUILDER_LESSONS (534), consumer-first
editing (536), diverge/converge brainstorming (598), owner-priority category
(608), adversarial case-making (626), quality criteria (632), three-axis
selection (638), brainstorm-before-backlog (644), existence-check (648),
counterfactual to Phase 2 (654), user-wall reframe (658). Key failures:
quality lesson (546), domain concentration (7 iters, accepted 608), post-hoc
steelman (652, not followed). Partial: self-review structure (646), impact
criterion (656).

**Recent:**
- **(660)** Neutralize ★-mark anchoring. **EFFECTIVE**: broke ★-chain.
- **(662)** Composition-first brainstorming. **EFFECTIVE**: builders 663, 665
  both composed existing subsystems. Confirmed across 2 iterations.
- **(664)** Split research from selection. **EFFECTIVE**: builder 665 did 5 web
  searches across 3 candidates before selecting. Findings table per candidate.
  Steelman comparison. Fixed 100% single-candidate search pattern.

## Evidence

- **15-iter trend**: +18.1 tests/iter, 41% rework. Diversity 73% (healthy).
  Research: 15/15 (saturated). Work: 10 feature, 4 architecture, 1 harden.
  Owner priorities: 10 pending, last progress iter 665 (1 builder iter ago).
- **Research→implementation gap**: Iter 665 research validated choice but
  didn't change implementation. Builder implements from first principles
  without carrying research insights into design decisions.

## Research Library

**Established foundations (applied pre-650, now baked into process):**
Structural > verbal (Arumugam), diverge/converge phases (Scaffolding Creativity),
steelman comparison (Choice-Supportive), non-inferable context only (ETH Zurich),
150-line threshold (Prompt Limits), trajectory evaluation (Agent-as-Judge),
diversity pressure (QDAIF, DGM), pre-action > post-action reflection (Devil's Adv).

| Paper | Key Insight | Applied |
|---|---|---|
| ECHO (2601.06794) | Co-evolve evaluator with agent — static criteria go stale | iter 662 |
| Agentless-1.5 (2024-2025) | Parallel candidate generation + voting > iterative refinement | reference |
| Context Engineering (Fowler 2025) | Quality bottleneck is what agent sees, not instructions | reference |
| STOP (COLM 2024) | Meta-improvement compounds more than object-level changes | reference |
| Self-Improving Coding Agent (2504.15228) | Agent editing own tools: 17-53% improvement | reference |
| AutoHarness (2603.03329, DeepMind) | Improving harness > improving prompts | reference |
| Curriculum Collapse (Agent0, 2511.16043) | Self-improving loops stagnate without external signal | reference |
| Self-Play Info Gain (2603.02218) | Evolution stalls when info gain → zero; sync roles | reference |
| HGM (Sakana, ICLR 2026 Oral) | Short-term optimization can kill long-term potential | reference |

## Improver Principles

1. **Data > instructions**: Surface data in tools the builder uses. Text
   instructions without data are ignored.
2. **Compression > addition**: Both prompts capped at 150 lines. Natural
   tendency is to add; resist it.
3. **Tool-call barriers change decisions**: Inject information via tool calls
   between decision phases to genuinely change behavior.
4. **Accept partial results at 3+ iterations**: If the same issue resists 3+
   interventions, the root cause is deeper. Redirect effort.
5. **Metric accuracy is load-bearing**: Validate metrics against ground truth.
   But max 1-in-5 iterations on tooling.
6. **Lessons work for procedures, not strategy**: For strategic change, modify
   evaluation criteria or inject data, not add text.
