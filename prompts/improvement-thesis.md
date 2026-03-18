# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 638)

**Resolved systemic issues**: Metric obsession (632), prompt overspecification
(632), legacy facades (632), prompt size enforcement (632), research declining
(634 — research went 4→36/iter), formulaic candidates (634 — diversity
requirement + Future Directions review working).

**Active issues:**
1. **No quality self-assessment**: Builder verifies mechanically (typecheck,
   tests) but never evaluates implementation quality or impact. Fix (638):
   self-review step between Verify and Record (Agent-as-Judge pattern).
2. **Never-tested files**: computer-use.ts (418L), custom-tool.ts (358L).
3. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.

## Intervention History

**Archived (iters 534-628)**: Key wins: BUILDER_LESSONS (534), consumer-first
editing (536), deferred reads (538), tool registration checklist (554),
CHANGELOG archive (568), diverge/converge brainstorming (598), research-before-
convergence (600), owner-priority category (608), top-neglected signal (612),
per-item next-steps (624), adversarial case-making (626), feasibility/evaluation/
research separation (628). Key failures: quality lesson (546), research strategy
lesson (540), domain concentration (7 iterations, accepted at 608).

**Recent (iters 632-638):**
- **(632)** Quality criteria + comparative + trend simplification. **EFFECTIVE**.
- **(634)** Research-after-candidates + diversity requirement. **EFFECTIVE**:
  research 4→36/iter, builder chose NEVER-addressed owner priority.
- **(636)** Three-axis selection + NOTES.md progress tracking. **EFFECTIVE**:
  iter 637 used three-axis table, added `→ Progress` annotation. Rework 23%.
- **(638)** Self-review step (Agent-as-Judge pattern) + BUILDER_LESSONS pruning.

## Evidence

- **10-iter trend (619-999)**: +22.6 tests/iter, 38% rework. Diversity 73%.
  Research: 8/10 iters (15/iter avg). Rework trending down: 20-23% in last
  2 builder iters vs 57-62% prior. Three-axis selection + research working.

## Research Library

| Paper | Key Insight | Applied |
|---|---|---|
| Arumugam et al. (ICLR 2025) | Structural changes > verbal encouragement | iter 624 |
| GEPA (ICLR 2026 Oral) | Structured reflection on traces >> scalar rewards | iter 614 |
| ETH Zurich (2602.11988) | Only non-inferable context helps; verbose/generic = noise | iter 562, 638 |
| Prompt Instruction Limits (2507.11538) | ~150 instruction threshold | iter 564 |
| Choice-Supportive Bias (AAAI 2025) | Force explicit comparison before committing | iter 626 |
| Deep Ideation (2511.02238) | Exploration before ideation: 10.67% quality lift | iter 630 |
| ICLR 2026 RSI Workshop | Prompt-only modifications plateau; expand to tools | reference |
| HGM (Sakana, ICLR 2026 Oral) | Short-term optimization can kill long-term potential | reference |
| SE-Agent (2508.02085) | Cross-trajectory inspiration breaks formulaic loops | iter 634 |
| QDAIF (ICLR 2024) | Quality-diversity: maintain diverse candidates, not just best | iter 634 |
| Agent-as-Judge (2508.02994) | Evaluate trajectory, not just outcome; ~85% human agreement | iter 638 |
| Karpathy AutoResearch (2026) | Atomic changes + scalar quality signal + append-only log | reference |


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
