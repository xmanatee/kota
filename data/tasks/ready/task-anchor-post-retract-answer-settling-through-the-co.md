---
id: task-anchor-post-retract-answer-settling-through-the-co
title: Anchor post-retract answer settling through the conversational agent loop
status: ready
priority: p1
area: architecture
summary: Extend src/conversational-agent-tools.integration.test.ts so a follow-up answer turn after a retracted memory record produces a cited envelope that does not reference the retracted record, anchoring the answer-layer settling for the cross-store correction loop end-to-end through the openai-tools harness.
created_at: 2026-04-28T16:58:59.125Z
updated_at: 2026-04-28T16:58:59.125Z
---

## Problem

The retract round-trip describe in `src/conversational-agent-tools.integration.test.ts`
(lines 403–501) anchors that the agent's `retract` tool removes a memory record
through the production `RetractProviderImpl` and that a follow-up `recall` turn
through the agent loop returns no hit for the retracted record's content. That
settles the read-side **recall** layer.

The next layer up — the **answer** synthesis — is unanchored after retract.
The personal-assistant correction loop's load-bearing claim is that retracting
an entry genuinely removes it as evidence, so a later cited answer does not
ground itself in retracted content. Today, after retract:

- the underlying `MemoryStore` no longer carries the record,
- the production `RecallProviderImpl` no longer surfaces it as a hit,

but no test proves that a follow-up `answer` turn through the agent loop
produces a synthesis whose persisted `AnswerHistoryRecord` carries zero
citations and zero `recallHits` referencing the retracted record. A regression
in retract's `MemoryContributor` removal semantics, in the recall pile after
retract, or in the synthesizer's evidence aggregation could cite a retracted
record without any test catching it.

This is the symmetric counterpart to the just-landed answer-then-answer chain
(commit `b5d67971`): each cross-store layer that the seam exposes should both
**chain** after capture/answer and **settle** after retract. With recall-after-
retract anchored and answer-after-retract not anchored, the correction loop's
answer-layer claim is documented but unverified end-to-end through the
production agent harness.

## Desired Outcome

- One additional `describe` block in
  `src/conversational-agent-tools.integration.test.ts` — alongside the four
  existing describes — that boots the shared cross-store fixture, captures a
  memory record by exercising `CaptureProviderImpl.capture` end-to-end, runs a
  scripted agent session that fires the `retract` tool on that memory id and
  then fires the `answer` tool on a query whose recall pile would have
  surfaced the retracted note before retract, and asserts:
  - the pre-retract `RecallProviderImpl.recall` for the chosen query did
    return a `memory`-source hit for the retracted id (sanity precondition),
  - the follow-up `answer` tool result is `{ ok: true }` and produces a cited
    envelope,
  - the persisted `AnswerHistoryRecord` for the follow-up turn carries zero
    citations whose `source === "memory" && id === retractedMemoryId`,
  - the persisted `AnswerHistoryRecord.recallHits` array does not contain any
    `memory`-source hit for the retracted id.
- A negative twin assertion in the same describe: with the same setup, the
  scripted ModelClient fabricates a `[memory:<retractedMemoryId>]` citation
  marker in its synthesis text. The citation parser must reject the marker
  (the underlying record is gone), the existing retry-and-reject contract
  must trip, and the follow-up `answer` tool result must be
  `{ ok: false, reason: "synthesis_failed" }`. The persisted answer-history
  store grows by one record carrying that failure result.
- The new describe runs through `runScriptedAgentSession` against the
  production `openai-tools` harness — same surface as the existing
  capture/recall/answer/retract anchors — so the behavior is proven through
  the agent loop, not directly against `AnswerProviderImpl`.

## Constraints

- One mechanism. Reuse the existing `buildCrossStoreFixture` /
  `registerCrossStoreTools` / `runScriptedAgentSession` helpers from
  `src/conversational-cross-store-fixture.integration.ts`. No second fixture,
  no test-only override on `AnswerProviderImpl` or `RetractProviderImpl`, no
  parallel scripted-stream helper.
- The retracted record must be reachable through `RecallProviderImpl.recall`
  before the agent retracts it (pre-recall sanity check), so a missing
  post-retract answer citation is meaningful rather than a no-op.
- The follow-up answer query must be related to the retracted note's content
  — same keyword-overlap discipline the retract round-trip describe already
  uses for `POST_RETRACT_RECALL_QUERY` — so `searchMemory`/`searchKnowledge`
  would have surfaced the captured note had it not been retracted.
- Use the production `RetractProviderImpl`, `RecallProviderImpl`, and
  `AnswerProviderImpl` against in-process `MemoryStore` / `KnowledgeStore`
  / `AnswerHistoryStore` instances on a temp project root. Do not mock any
  of the three providers.
- The dangerous `retract` tool must run under the same harness posture as
  the existing retract round-trip describe. No test-only autonomy elevation,
  no test-only tool-admission override.
- The negative arm uses the same `[memory:<id>]` citation grammar and the
  same retry-and-reject contract anchored in the answer-then-answer chain.
  No parallel parser, no second public knob on `AnswerProviderImpl`, no
  test-only synthesizer.
- No new top-level integration test file; extend
  `src/conversational-agent-tools.integration.test.ts`. The file is already
  ~500 lines; if the new describe pushes it appreciably further, extract a
  shared helper into `src/conversational-cross-store-fixture.integration.ts`
  rather than splitting the test file by feature. A dedicated file-size
  refactor of these conversational integration tests is a separate task —
  do not bundle it here.
- No fan-out from this task. CLI / web / Telegram / macOS / mobile / Slack
  render polish for retract→answer chaining, per-turn primer wording for
  post-retract synthesis, and any score-normalization tuning between recall
  contributors are out of scope.

## Done When

- `src/conversational-agent-tools.integration.test.ts` carries a new
  `describe("conversational agent tools — post-retract answer settles", ...)`
  block — alongside the existing four — that exercises the post-retract
  answer chain through the agent loop and asserts:
  - the pre-retract recall pile contained a `memory`-source hit for the
    captured id,
  - the follow-up `answer` tool result is `{ ok: true }`,
  - the persisted `AnswerHistoryRecord` for the follow-up turn has zero
    `citations[i]` with `source === "memory" && id === retractedMemoryId`,
  - the persisted `AnswerHistoryRecord.recallHits` for the follow-up turn
    contains no `memory`-source hit for the retracted id.
- A negative-arm test in the same describe asserts that a fabricated
  `[memory:<retractedMemoryId>]` marker still trips the retry-and-reject
  path and yields `{ ok: false, reason: "synthesis_failed" }` from the
  follow-up turn, with one extra `AnswerHistoryRecord` carrying that
  failure result.
- `src/modules/retract/AGENTS.md` and `src/modules/answer/AGENTS.md` add
  the new describe to their integration-anchor lists, mirroring the way
  the answer-then-answer chain was added to the answer module's anchor
  list.
- `pnpm test` and `pnpm typecheck` are green at the project root.
- The run directory contains a brief note recording the chosen capture
  text, the follow-up answer query, the retracted memory id, and the
  synthesis the scripted ModelClient emitted, so a future contributor
  can see the exact citation shape used to anchor this chain.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T16-54-01-572Z-explorer-ychkwd/` after the answer-then-
answer chain landed (commit `b5d67971`). With every recall source the seam
exposes (knowledge, memory, history, tasks, answer) now anchored on at least
one chain through `src/conversational-agent-tools.integration.test.ts`, the
retract→answer settling layer is the last unanchored claim of the cross-store
correction loop. The retract round-trip describe at lines 403–501 anchors the
recall layer settling after retract; this task adds the symmetric anchor for
the answer layer.

## Initiative

Cross-store personal-assistant seam. The conversational loop should prove,
through the production agent harness, that capture/recall/answer/retract all
chain coherently and settle coherently — including the case where retracting
a captured note removes it as evidence not only from `recall` but also from
the cited envelope a follow-up `answer` synthesizes. With this task in place,
every load-bearing layer of the cross-store correction loop has an end-to-end
agent-loop anchor.

## Acceptance Evidence

- Diff covering the new positive and negative arms in
  `src/conversational-agent-tools.integration.test.ts`, the AGENTS.md
  pointer updates in `src/modules/retract/` and `src/modules/answer/`,
  and any small adjustments to the shared fixture if a helper is genuinely
  needed for the post-retract synthesis script.
- `pnpm test` output showing the new positive and negative arms pass
  alongside the existing capture/recall/answer/retract suites.
- A short note in the run directory recording the seed capture text, the
  retracted memory id, the follow-up query, and the synthesizer reply
  used to drive the scripted ModelClient — so a future explorer or
  improver can see the exact citation shape the anchor relies on.
