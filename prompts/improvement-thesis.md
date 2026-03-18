# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 650)

**Resolved systemic issues**: Metric obsession (632), prompt overspecification
(632), legacy facades (632), prompt size enforcement (632), research declining
(634), formulaic candidates (634), no self-assessment (638), subsystem tunnel
vision (640), maintenance convergence (642), backlog anchoring (644),
perfunctory self-review (646), misleading top-neglected signal (646),
redundant research on existing features (648 — grep-first in Phase 2),
parse-log STALE metric miscalculation (650 — count actual entries, not iter arithmetic).

**Active issues:**
1. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.
2. **Self-review untested**: Builder found 0 issues in 2 consecutive self-reviews
   (647, 649). Could be genuine clean code or degeneration-of-thought (MAR).
   Need more data before intervening.

## Intervention History

**Archived (iters 534-628)**: Key wins: BUILDER_LESSONS (534), consumer-first
editing (536), deferred reads (538), tool registration checklist (554),
CHANGELOG archive (568), diverge/converge brainstorming (598), research-before-
convergence (600), owner-priority category (608), top-neglected signal (612),
per-item next-steps (624), adversarial case-making (626), feasibility/evaluation/
research separation (628). Key failures: quality lesson (546), research strategy
lesson (540), domain concentration (7 iterations, accepted at 608).

**Recent (iters 632-650):**
- **(632-638)** Quality criteria, diversity, three-axis selection, self-review.
  All **EFFECTIVE**.
- **(640)** Diminishing returns on novelty + vitest mock lesson. **PARTIAL**.
- **(642)** Test-delta streak penalty + capability candidates. **EFFECTIVE**.
- **(644)** Brainstorm-before-backlog in Phase 1. **EFFECTIVE**.
- **(646)** Design-aware self-review + top-neglected lesson. **PARTIAL**:
  self-review structured (3 checks) but found 0 issues in 647, 649.
- **(648)** Existence-check before research. **EFFECTIVE**: builder 649
  grepped for candidates before web research, zero wasted research.
- **(650)** Fix parse-log STALE metric. Replaced iter-arithmetic with actual
  entry count — "177 iters ago" → "3 iters ago." Removes false pressure.

## Evidence

- **15-iter trend**: +18.0 tests/iter, 35% rework. Diversity 84%.
  Research: 14/15 iters (16/iter avg). 10 consecutive EFFECTIVE interventions.

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
| Self-Improving Coding Agent (2504.15228) | Letting agent edit own tools/strategies: 17-53% improvement | reference |
| MAR: Multi-Agent Reflexion (2512.20845) | Single-agent review suffers degeneration-of-thought; diverse perspectives break it | reference |
| TiMem (2601.02845) | Temporal memory hierarchy: recent=detailed, old=compressed to principles | reference |
| Architecture-as-Context (Sylvester 2026) | Agents drift when architectural constraints aren't in context | iter 646 |
| ToolTree (ICLR 2026, 2603.12740) | Pre-execution feasibility check + bidirectional pruning reduces wasted calls | iter 648 |
| SeekBench (2509.22391) | Agents fail to verify assumptions against local state before external research | iter 648 |

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
