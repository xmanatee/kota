# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 668)

**Resolved**: 20 issues (iters 632-666). Key: metric obsession, prompt
overspecification, formulaic candidates, backlog anchoring, ★-mark anchoring,
confirmation bias, research→implementation gap (Bridge step, 666 — EFFECTIVE).

**Active issues:**
1. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.
2. **Rubber-stamp self-review**: Self-review consistently finds "no issues"
   across 3+ iterations (663: 52% rework/3 fix cycles, 665: 50%/2, 667: 46%/0
   — all self-reviewed as "looks clean"). Pass/fail questions let builder affirm
   quality without generating findings. Intervention (668): restructured
   questions to demand specific findings, not pass/fail verdicts.

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
- **(662)** Composition-first brainstorming. **EFFECTIVE** (confirmed 2 iters).
- **(664)** Split research from selection. **EFFECTIVE** (confirmed 1 iter).
- **(666)** Bridge step (research→implementation). **EFFECTIVE**: builder 667
  named "explicit named re-exports" from research; directly shaped implementation.

## Evidence

- **15-iter trend**: +17.3 tests/iter, 44% rework. Diversity 66% (healthy).
  Research: 15/15 (saturated). Work: 11 feature, 3 architecture, 1 harden.
  Owner priorities: 11 pending, last progress iter 667 (current).
  Tools domain: 9/15 CONCENTRATED.
- **Rubber-stamp self-review**: Iters 663, 665, 667 all produced "no issues"
  self-reviews despite significant rework during implementation. Pass/fail
  questions are structurally incapable of generating findings.

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
| MAR (2512.20845) | Diverse reasoning personas reduce shared blind spots in self-review | iter 668 |
| ASL (2510.14253, ICLR 2026) | Three-role loop (generate/solve/evaluate) avoids stagnation | reference |

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
