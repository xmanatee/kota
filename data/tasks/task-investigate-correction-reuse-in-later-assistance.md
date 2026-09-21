---
status: blocked
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

## Coverage Investigation — September 20

Assessed writer revision `490e8393f1a07d923481cc34a846fc2ff65a7ef9`.
The archived scenarios were implemented as focused tests, not shipped live
fixtures: `23c201c55` added `memory-lifecycle-aging.test.ts`, and `91d910a91`
added `proactive-cross-session-intent-resolution.test.ts` under eval-harness.
Both were deleted by `7cecbcb0153f1d7e02e9a8ed6b6d588553f2a6b4` on September 8.
Their pre-deletion code remains inspectable in Git: `applyLifecyclePatch`
selected a patch by string matching, and `createCorrectPlan` supplied a literal
response and tool-call plan. Those artifacts measured deterministic store and
scorer behavior, not a model's later use of a correction.

Maintained coverage is adjacent rather than an equivalent live replacement:

- `src/modules/memory/store.test.ts` reloads correction metadata with provenance;
  `src/modules/recall/work-memory-provenance.test.ts` checks supersession rendering
  and retraction through real stores. These cover persistence and discoverability.
- `src/modules/history/conversation-recall.test.ts` covers history search/read;
  `src/modules/working-memory/working-memory.test.ts` covers durable reload,
  session isolation and compaction-related prompt behavior.
- `src/conversational-agent-tools.integration.test.ts` exercises the conversational
  tools with real stores but a scripted model client and synthesizer.
  `src/recall-answer-pipeline.integration.test.ts` uses a deterministic synthesizer
  and handcrafted contributors. Neither establishes spontaneous response use.
- `src/preset-parity.live.test.ts` and its fixture exercise real capture, recall
  and answer calls, but the query includes the seeded nonce; there is no
  correction/no-correction pair or later meeting request. Even a passing parity
  result would not settle this research question.

The available run export (`agent/issue-evidence.json`, captured September 20)
contains only the explorer metadata and no writer evidence. The writer has no
`.kota/runs` directory; canonical run-directory enumeration was denied. That
limits inspection, not the existence of historical evidence. No matched live
result was available in the inspected material. Source review establishes the
coverage boundaries above; these tests were not re-executed for this research.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An applicable host-authorized contained execution profile for the matched correction-reuse observation, or equivalent attributable KOTA transcript and store/recall evidence.

The path is an evidence-discovery hint, not a required capture location.

An authorized, isolated KOTA execution capability for the matched fresh-session
observation, or an equivalent attributable export of that observation. The
existing native request/reply service was actually queried with
`pnpm kota eval contained '{"operation":"inspect"}'` in this run. It returned
`is_error: true` and `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment`.
Thus the host currently exposes no configured profile through that surface.
This is a host grant prerequisite, not an inference that credentials, models or
Docker are absent. Worker requests cannot configure host access.

Resume when the host owner supplies an applicable scope-authorized execution
profile through the existing contained-evaluation setup, or supplies comparable
KOTA transcripts and persistence/discovery records through the existing evidence
export path. A configured profile alone is not measurement or acceptance; it
must permit the required observation using the normal history/capture/recall
owners. No particular artifact directory, new runner, imported benchmark or
permanent fixture is required.

Use the same prior state, later local meeting-planning request, model and relevant
conditions in both arms, varying only availability of the committed correction.
Retain the correction interaction, committed records, fresh-session tool calls
and discovered evidence, actual responses, and absence of external scheduling
effects. Classify any failure by persistence, discovery or response use only
from those observations. No matched comparison ran here; no product gap is
established, and the later-assistance question remains unanswered. No follow-up
implementation task or model/prompt change is justified yet.

Only this research task's status and findings changed. Detailed source/probe
provenance is retained in this run's `agent/correction-reuse-research.md` and
`agent/contained-inspect-result.json`. The earlier preservation note is historical;
this blocked disposition supersedes its proposed open-task handoff.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-21T02:46:12.959Z -->
