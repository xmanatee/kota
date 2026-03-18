# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 636)

**Resolved systemic issues**: Metric obsession (632), prompt overspecification
(632), legacy facades (632), prompt size enforcement (632), research declining
(634 — research went 4→36/iter), formulaic candidates (634 — diversity
requirement + Future Directions review working).

**Active issues:**
1. **Selection quality**: Builder researches well but "deepest opportunity" is
   vague. Fix (636): explicit three-axis criterion (novelty × owner alignment ×
   research depth) replaces subjective "deepest opportunity."
2. **Progress tracking gap**: Builder addresses owner priorities but doesn't
   annotate NOTES.md, breaking staleness tracker. Fix (636): moved NOTES.md
   update to Record phase with explicit `→ Progress` instruction.
3. **Never-tested files**: computer-use.ts (418L), custom-tool.ts (358L).
4. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.

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
- **(634)** Research-after-candidates + diversity requirement. **EFFECTIVE**:
  iter 635 had 36 searches (vs 4 prior), chose NEVER-addressed owner priority
  (source reorg), 20% rework. Both mechanisms confirmed working.
- **(636)** Three-axis selection criterion + NOTES.md progress tracking fix.

## Evidence

- **10-iter trend (619-999)**: +28 tests/iter, 40% rework, 5 fix cycles.
  Work diversity 73% (healthy). Research: 7/10 iters (12/iter avg).
  Iter 635: research surged to 36, rework dropped to 20%.

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
| Intrinsic Metacognition (OpenReview) | Truly self-improving agents need self-eval of learning process | reference |
| MAR (Multi-Agent Reflexion) | Diverse personas + judge = fewer blind spots | reference |

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
