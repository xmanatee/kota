---
status: open
priority: p3
---
# Does a user correction improve KOTA's later assistance?

Research lead from explorer `2026-09-15T00-56-17-888Z-explorer-gv8bmk`.

[StreamMemBench v2](https://arxiv.org/html/2606.14571v2), revised August 26
and read online September 15, separates stored evidence, initial use,
immediate correction, and later reuse. Its paired interaction-commit ablation
holds the later query and prior memory constant while varying whether the
intervening interaction is saved. That comparison is more informative than
assuming two different requests have equal difficulty. The
[project README](https://github.com/landian60/StreamMemBench) describes public
data and adapters; no benchmark was executed here.

KOTA relevance: a user corrects an assistant's suggested meeting time, then
opens a fresh session to plan a different meeting. Can the assistant use the
correction without being reminded, while keeping any scheduling effect within
the user's authorization? This is a hypothetical product example, not an
observed defect.

Existing work already covers adjacent outcomes:

- Archived `task-add-a-longitudinal-memory-lifecycle-aging-fixture-` and
  `task-add-proactive-cross-session-intent-resolution-eval` cover revision,
  aging and hidden intent. Their historical task contracts do not establish
  today's live model behavior.
- `src/modules/recall/work-memory-provenance.test.ts` exercises correction
  metadata and retraction through real stores; `src/recall-answer-pipeline.integration.test.ts`
  uses a deterministic synthesizer for transport/citation behavior.
- `src/modules/eval-harness/AGENTS.md` requires a named model-dependent
  failure and a model/prompt decision before retaining a fixture.

Open question: does a matched KOTA observation reveal lost correction reuse
that existing coverage and retained evidence cannot explain? First locate
the maintained successors of the archived scenarios. If useful, compare the
same later request with and without the preceding correction available through
normal history/capture/recall owners; distinguish persistence, discovery and
actual response use. A successful store update alone cannot answer this.

Keep this as research until that comparison justifies a concrete implementation outcome.
No new memory backend, self-promoted skill store, benchmark import or automatic
fixture is proposed. Existing external-pattern decisions on Letta/Hermes and
Reflexion remain applicable; this lead does not establish their revisit conditions.

## Research Outcome And Acceptance

Determine whether current KOTA assistance reuses a correction in a later session,
and whether any observed failure belongs to persistence, discovery, or response
use. This is a p3 research lead, not a confirmed regression or a request to add
a fixture.

- Locate maintained coverage and retained evidence for the archived scenarios;
  record retirement or replacement honestly. The September 15 triage found the
  archived contracts but no matching scenario names in current eval-harness
  sources; that name search does not establish a behavioral coverage gap.
- If existing evidence cannot answer the question, observe a matched later
  request with and without the correction committed through normal KOTA owners.
  Keep prior state, query, model and relevant execution conditions comparable;
  retain the actual transcript, persistence/discovery evidence and response use.
  Use a local scheduling example with no external calendar effect.
- Conclude with an evidence-grounded disposition: existing coverage suffices,
  no demonstrated gap, or a concrete deduplicated follow-up owned by the failing
  boundary. Insufficient live evidence remains explicit; a store assertion or
  an unrelated benchmark score is not proof of later assistance quality.

Source URLs were readable during September 15 triage. No KOTA comparison or
external benchmark ran. Do available coverage investigation first; if live
observation then requires unavailable authorized capability, name that specific
prerequisite using the existing task contract rather than inventing a new runner
or setup workstream.
