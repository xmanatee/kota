# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 634)

**Resolved systemic issues (iter 632)**: Metric obsession (capped 1-in-5),
prompt overspecification (simplified), legacy facades (banned + cleaned),
prompt size enforcement (150 lines, step.sh validates).

**Active issues:**
1. **Research declining**: 4 searches/iter in last 2 iters (vs 9 avg). Builder
   treats early web searches as checkbox. Fix: moved research to Phase 2 where
   it serves candidate evaluation, not undirected inspiration.
2. **Formulaic candidates**: Builder gravitates toward safe compositions of
   existing systems. Fix: added diversity requirement (≥1 candidate from
   untouched area) and CHANGELOG "Future directions" review.
3. **Never-tested files**: computer-use.ts (418L), custom-tool.ts (358L).
4. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.
5. **Owner's big requests**: Source reorg, true plug-n-play modules — stalling.

## Intervention History

**Archived (iters 534-628)**: Key wins: BUILDER_LESSONS (534), consumer-first
editing (536), deferred reads (538), tool registration checklist (554),
CHANGELOG archive (568), diverge/converge brainstorming (598), research-before-
convergence (600), owner-priority category (608), top-neglected signal (612),
per-item next-steps (624), adversarial case-making (626), feasibility/evaluation/
research separation (628). Key failures: quality lesson (546), research strategy
lesson (540), domain concentration (7 iterations, accepted at 608).

**Recent (iters 630-634):**
- **(630)** Inspiration-first brainstorming. **PARTIALLY EFFECTIVE**: found
  novel ideas but research still shallow (4 searches).
- **(632a)** Quality criteria + comparative. **EFFECTIVE**: iter 633 did strong
  top-2 comparison with concrete demos. Research still low (4 searches).
- **(632b)** Trend simplification: 22→9 signals. **EFFECTIVE**: builder still
  reads and acts on trend data (noticed STALE, picked owner priority).
- **(634)** Research-after-candidates + diversity requirement. Restructured
  brainstorming: research now targets specific candidates, not undirected.
  Added ≥1 candidate from untouched area + CHANGELOG Future Directions review.

## Evidence

- **10-iter trend (617-999)**: +30 tests/iter, 41% rework, 6 fix cycles.
  Work diversity 82% (healthy). Research: 7/10 iters (9/iter avg).
  Last 2 iters: research declining (4/iter), rework rising (57%→62%).

## Research Library

| Paper | Key Insight | Applied |
|---|---|---|
| Arumugam et al. (ICLR 2025) | Structural changes > verbal encouragement | iter 624 |
| GEPA (ICLR 2026 Oral) | Structured reflection on traces >> scalar rewards | iter 614 |
| ETH Zurich (2602.11988) | Verbose context files reduce success 3%, cost +20% | iter 562 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold | iter 564 |
| Choice-Supportive Bias (AAAI 2025) | Force explicit comparison before committing | iter 626 |
| Deep Ideation (2511.02238) | Exploration before ideation: 10.67% quality lift | iter 630 |
| ICLR 2026 RSI Workshop | Prompt-only modifications plateau; expand to tools | reference |
| HGM (Sakana, ICLR 2026 Oral) | Short-term optimization can kill long-term potential | reference |
| SE-Agent (2508.02085) | Cross-trajectory inspiration breaks formulaic loops | iter 634 |
| QDAIF (ICLR 2024) | Quality-diversity: maintain diverse candidates, not just best | iter 634 |
| SGICE (Addy Osmani) | Self-generated in-context examples: 73→89-93% lift | potential |
| MPO (EMNLP 2025) | Meta-plan abstraction escapes local optima | potential |
| SICA (ICLR 2025 WS) | Self-editing agent: 17-53% improvement via self-modification | reference |
| STOP (NeurIPS 2025) | Recursive self-improvement of the improver itself | reference |

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
