# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 646)

**Resolved systemic issues**: Metric obsession (632), prompt overspecification
(632), legacy facades (632), prompt size enforcement (632), research declining
(634), formulaic candidates (634), no self-assessment (638), subsystem tunnel
vision (640), maintenance convergence (642), backlog anchoring (644 — iter 645
produced 3/5 fresh candidates).

**Active issues:**
1. **Perfunctory self-review**: Builder rubber-stamps own work ("looks good").
   Self-review step exists (638) but lacks design-quality questions. Fix (646):
   added integration/edge-case/API checks to self-review prompt.
2. **Misleading "top neglected" signal**: parse-log "NEVER" means "never
   modified by builder," not "untested." Builder wasted time in 645 discovering
   computer-use.ts (43 tests) and custom-tool.ts (35 tests) are well-tested.
   Addressed via BUILDER_LESSONS; metric fix deferred.
3. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.

## Intervention History

**Archived (iters 534-628)**: Key wins: BUILDER_LESSONS (534), consumer-first
editing (536), deferred reads (538), tool registration checklist (554),
CHANGELOG archive (568), diverge/converge brainstorming (598), research-before-
convergence (600), owner-priority category (608), top-neglected signal (612),
per-item next-steps (624), adversarial case-making (626), feasibility/evaluation/
research separation (628). Key failures: quality lesson (546), research strategy
lesson (540), domain concentration (7 iterations, accepted at 608).

**Recent (iters 632-640):**
- **(632)** Quality criteria + comparative + trend simplification. **EFFECTIVE**.
- **(634)** Research-after-candidates + diversity requirement. **EFFECTIVE**.
- **(636)** Three-axis selection + NOTES.md progress tracking. **EFFECTIVE**.
- **(638)** Self-review step (Agent-as-Judge). **EFFECTIVE**: iter 639 ran
  self-review checklist unprompted, noted future directions.
- **(640)** Diminishing returns on novelty + vitest mock lesson. **PARTIAL**:
  builder 641 picked different area (confirmed), but chose maintenance (0 tests).
- **(642)** Test-delta streak penalty + capability candidate requirement.
  **EFFECTIVE**: iter 643 chose research delegate (+15 tests), breaking streak.
- **(644)** Brainstorm-before-backlog in Phase 1. **EFFECTIVE**: iter 645
  produced 3/5 fresh candidates (vs 4/5 recycled in 643). Backlog items
  appeared as supplements, not anchors. Test delta +13, research 20.
- **(646)** Design-aware self-review + top-neglected lesson. Targets
  perfunctory self-review and misleading metric.

## Evidence

- **15-iter trend (621-999)**: +19.6 tests/iter, 36% rework. Diversity 86%.
  Research: 13/15 iters (15/iter avg). Backlog anchoring resolved (644).

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
| DGM (Sakana, 2505.22954) | Open-ended archive search beats hill-climbing; keep diverse ancestors | iter 640 |
| Self-Play Info Gain (2603.02218) | Evolution stalls when learnable info gain → zero; sync roles | reference |
| CycleQD (ICLR 2025) | Cyclic skill rotation prevents any capability from dominating | iter 640 |
| STOP (COLM 2024) | Meta-improvement compounds more than object-level changes | reference |
| Intrinsic Metacognition (ICML 2025) | Fixed scoring functions plateau; agent needs trajectory self-awareness | iter 642 |
| Scaffolding Creativity (2510.26490) | Separating divergent/convergent phases reduces anchoring | iter 644 |
| Cognitive Bias in LLMs (2509.22856) | Anchoring affects 17-57% of responses; detail + grounding mitigates | iter 644 |
| ReVeal (2506.11442) | Co-evolve generation + verification; turn-level rewards > outcome-only | reference |
| Self-Improving Coding Agent (2504.15228) | Letting agent edit own tools/strategies: 17-53% improvement | reference |
| Architecture-as-Context (Sylvester 2026) | Agents drift when architectural constraints aren't in context | iter 646 |

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
