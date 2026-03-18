# Improvement Thesis

Strategic context for the improver. Read at start; update when evidence changes.

## Current Hypothesis (updated iter 662)

**Resolved systemic issues**: Metric obsession (632), prompt overspecification
(632), legacy facades (632), prompt size enforcement (632), research declining
(634), formulaic candidates (634), no self-assessment (638), subsystem tunnel
vision (640), maintenance convergence (642), backlog anchoring (644),
perfunctory self-review (646), misleading top-neglected signal (646),
redundant research on existing features (648), parse-log STALE metric (650),
tools concentration (653), post-hoc steelman (654), brainstorm axis collapse
(658), ★-mark anchoring in selection (660 — broke 3-iter ★-chain).

**Active issues:**
1. **No runtime testing**: Missing ANTHROPIC_API_KEY. Owner needs to set it.
2. **Addition bias over composition**: Codebase has 30+ subsystems but builder
   keeps adding standalone tools (9/15 recent iters = new features). At this
   maturity, composing existing subsystems often delivers more value. Intervention
   (662): reword Capability axis to put composition first, with concrete
   instruction to scan DESIGN.md headers for pairs that don't yet interact.

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
- **(660)** Neutralize ★-mark anchoring. **EFFECTIVE**: builder 661 chose
  owner request (prompt templates) over ★-marked items, breaking the
  655→657→659 ★-chain. Owner staleness: 4 → 1 builder iter.

## Evidence

- **15-iter trend**: +18.4 tests/iter, 38% rework. Diversity 78% (healthy).
  Research: 15/15 iters (saturated). Work: 9 feature, 5 architecture, 1 harden.
  Owner priorities: 9 pending, last progress 1 builder iter ago (661).
- **Addition pattern**: 30+ subsystems in DESIGN.md, but recent iters mostly
  add standalone tools. Only a few (event handlers 645, provider wiring 653)
  compose existing subsystems.

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
| Variance Inequality (2512.02731) | When improvement stalls, strengthen the verifier, not the generator | iter 652 |
| Free-MAD (2509.11035) | Anti-conformity mode + steelman opposition breaks silent agreement/rubber-stamps | iter 652 |
| Devil's Advocate (EMNLP 2024) | Pre-action reflection 45% more effective than post-action review | iter 654 |
| PAE: Corrupt Success (2603.03116) | Agents skip procedural steps while achieving correct outcomes | iter 654 |
| GEA (2602.04837) | Performance-Novelty joint criterion; saturated metrics should rotate | iter 656 |
| AgentEvolver (2511.10395) | Task Synthesis from user-tasks, not capability gaps; generation shapes outcomes more than selection | iter 658 |
| ECHO (2601.06794) | Co-evolve evaluator with agent — static criteria go stale as capability grows | iter 662 |
| Live-SWE-agent (2511.13646) | Agent evolves own scaffold at runtime; minimal start → accumulated tools | reference |
| AutoHarness (2603.03329, DeepMind) | Improving code harness > improving prompts; smaller model + good harness > larger without | reference |

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
