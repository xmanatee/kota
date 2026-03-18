# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 632)

**Owner audit (iter 632) identified systemic issues — now structurally fixed:**

1. **Improver metric obsession**: 4 of 12 recent improver iterations (614, 616,
   618, 620) spent on parse-log.py fixes — 33% of cycles on measurement tooling.
   Now capped at 1-in-5 by the tooling budget guardrail.
2. **Builder prompt overspecification**: Brainstorming had 5 mandatory categories
   + 3 Phase 2 sub-steps. Simplified to 3 categories and natural flow.
3. **Never-tested files as wallpaper**: computer-use.ts (418L), custom-tool.ts
   (358L), guardrails.ts (282L) flagged for dozens of iterations, never addressed.
4. **No runtime testing**: Every iteration ends "runtime SKIP" due to missing
   ANTHROPIC_API_KEY. step.sh now warns. Owner needs to set the env var.
5. **Owner's big requests stalling**: Source structure reorg, true plug-n-play
   modules, self-hosting loop — repeatedly deferred as "too large."
6. **Legacy facades**: Re-export shims from file splits now banned by builder
   guardrail. Existing facades (module-factory.ts, openai-model-client.ts)
   queued for cleanup.
7. **Prompt size enforcement**: Both prompts capped at 150 lines, enforced by
   step.sh validation. Forces remove-before-add discipline.

**Active issues:**
1. **Composition verification** — No E2E for batch/pipe/map.
2. **System prompt scaling** — 33 tools, ~200 chars headroom.
3. **Process quality** — Focus on improving builder creativity and implementation
   quality through better conditions, not more procedure.

## Intervention History

**Archived (iters 534-628)**: Key wins: BUILDER_LESSONS (534), consumer-first
editing (536), deferred reads (538), tool registration checklist (554),
CHANGELOG archive (568), diverge/converge brainstorming (598), research-before-
convergence (600), owner-priority category (608), top-neglected signal (612),
per-item next-steps (624), adversarial case-making (626), feasibility/evaluation/
research separation (628). Key failures: quality lesson (546), research strategy
lesson (540), domain concentration (7 iterations, accepted at 608).

**Recent (iters 630-632):**
- **(630)** Inspiration-first brainstorming. **PARTIALLY EFFECTIVE**: iter 631
  found novel blackboard idea from web research but only 4 total searches.
- **(632a)** Quality criteria + comparative research. **INCONCLUSIVE**: iter 999
  was refactoring, not a feature. Need feature iteration to evaluate.
- **(632b)** Trend output simplification: 22 signals → 9. Owner-requested.
  Reduces cognitive load during builder brainstorming.

## Evidence

- **10-iter trend (615-999)**: +29.5 tests/iter, 38% rework, 7 fix cycles.
  Work diversity 82% (healthy). Research: 7/10 iters (10/iter avg).

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
| SGICE (Addy Osmani) | Self-generated in-context examples: 73→89-93% lift | potential |
| MPO (EMNLP 2025) | Meta-plan abstraction escapes local optima | potential |

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
