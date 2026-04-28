---
id: task-anchor-answer-then-answer-chain-prior-cited-answer
title: Anchor answer-then-answer chain (prior cited answer becomes evidence for a follow-up cited answer) through the conversational agent loop integration tests
status: ready
priority: p1
area: architecture
summary: Extend src/conversational-agent-tools.integration.test.ts so a follow-up answer turn that has a matching prior cited-answer envelope produces a new synthesis that carries an [answer:<id>] citation marker tying the new answer back to the prior envelope, anchoring the synthesizer's documented prior-answer chaining behavior end-to-end through the openai-tools harness.
created_at: 2026-04-28T16:22:20.175Z
updated_at: 2026-04-28T16:22:20.175Z
---

## Problem

`ca9b429a` ("Surface prior cited answers as a fifth recall contributor")
landed the answer-history corpus as an `answer`-source `RecallContributor`
and added one integration assertion under
`src/conversational-agent-tools.integration.test.ts` ("conversational agent
tools — prior answers surface as recall hits") that exercises the **recall
side** of the chain: seed an `AnswerProvider.answer` call, fire the agent's
`recall` tool on a similar query, assert an `answer`-source hit comes back
in the rendered tool output.

That anchors `recall` returning the new source. It does **not** exercise the
behavior the answer module already claims:

> "The `answer` arm covers the synthesizer chaining through a prior cited-
> answer envelope when recall surfaced one."
> — `src/modules/answer/AGENTS.md`

> ```
> case "answer":
>   return `prior cited answer to "${hit.query}" — ${hit.preview}`;
> ```
> — `src/modules/answer/synthesis-prompt.ts:42`

The `RecallSource` union, the `[source:id]` citation grammar, the
`describeHit` rendering, and the `selectCitedHits` parser all already accept
the `answer` arm. The synthesizer prompt names "answer" as one of the
sources it can be shown. But there is no end-to-end test where:

- the agent calls `answer` on one query,
- a follow-up turn calls `answer` on a **related** query,
- the second synthesis cites the first envelope through an `[answer:<id>]`
  marker, and
- the parsed `AnswerHistoryRecord` for the follow-up turn reflects that
  citation.

That is the load-bearing behavior of the conversational personal-assistant
claim — KOTA's own prior answers should genuinely ground new turns with
attribution, not merely appear as a retrievable corpus. The recent integration
anchors (commit `1bafc23b` capture→answer→history, commit `4385e5da`
capture→recall, commit `f34e3714` retract through agent loop) all settled
exactly this kind of "the surface lights up but the actual chain runs end-to-
end through the production seam" gap. The answer-then-answer chain is the
last unanchored chain that the just-landed fifth contributor opened.

## Desired Outcome

- One additional `describe` in
  `src/conversational-agent-tools.integration.test.ts` that boots the shared
  cross-store fixture, seeds an answer-history record by calling
  `AnswerProviderImpl.answer` end-to-end on one query, runs a scripted
  agent session that fires the `answer` tool on a follow-up question whose
  recall hits include the prior envelope, and asserts the second synthesis
  cites the prior envelope.
- The follow-up assertion runs through `runScriptedAgentSession` against
  the production `openai-tools` harness — same surface as the existing
  capture/recall/answer/retract anchors — so the behavior is proven through
  the agent loop, not directly against `AnswerProviderImpl`.
- The scripted ModelClient produces a synthesizer reply for the follow-up
  turn that includes an `[answer:<id>]` marker referencing the seeded
  envelope's id. The test asserts `parseCitations` resolves that marker
  against the typed hit pile and the resulting `AnswerHistoryRecord` for
  the follow-up turn carries the `answer`-source citation in its
  `citations` array and the matching hit in its `recallHits` array.
- A negative twin assertion: the second synthesis is rejected (as
  `synthesis_failed`) when the scripted reply cites a fabricated
  `[answer:never-existed]` marker, so the existing retry-and-reject
  contract still holds for the answer arm.

## Constraints

- One mechanism. The new test reuses the existing
  `buildCrossStoreFixture` / `registerCrossStoreTools` /
  `runScriptedAgentSession` helpers from
  `src/conversational-cross-store-fixture.integration.ts`. No second
  fixture, no test-only override on `AnswerProviderImpl`, no parallel
  scripted-stream helper.
- The follow-up question must differ from the seed query so the test
  proves the answer-history corpus actually grounds *related* turns —
  not just identical re-asks. The keyword overlap must be enough that
  `AnswerHistoryStore.searchAnswers` ranks the seeded record into the
  top-K used by the synthesizer.
- No new public knob on `AnswerProviderImpl`. The synthesizer remains a
  `Synthesizer` injected through `AnswerProviderOptions`; the test
  scripts the synthesizer via the existing `ModelClient` surface used by
  the openai-tools harness.
- The negative twin uses the same harness posture and registration as
  the positive arm. No test-only autonomy elevation, no parallel
  citation parser. The assertion goes through the published
  `AnswerResult` envelope, not through internal state.
- The answer module's `AGENTS.md` and the recall module's `AGENTS.md`
  stay aligned — the chaining claim moves from "documented" to
  "documented and anchored" so the AGENTS line that names the integration
  anchor includes this test (matching the pattern retract uses).
- No fan-out from this task. It is one integration anchor. CLI render
  polish, surface-level rendering on web/Telegram/Slack/macOS/mobile,
  per-turn primer wording for prior-answer chaining, and any score-
  normalization tuning between the keyword `answer` contributor and the
  embedding-backed contributors are out of scope.

## Done When

- `src/conversational-agent-tools.integration.test.ts` carries a new
  `describe` block — alongside the existing four — that exercises the
  answer-then-answer chain through the agent loop and asserts:
  - the follow-up `answer` tool result contains an inline `[answer:<id>]`
    marker referencing the seeded envelope's id,
  - the persisted `AnswerHistoryRecord` for the follow-up turn carries
    a citation with `source === "answer"` and the matching id, and
  - the recorded `recallHits` for that follow-up record include the
    prior envelope as an `answer`-source hit.
- A negative-arm test in the same describe asserts that a fabricated
  `[answer:not-a-real-id]` marker still trips the retry-and-reject path
  and yields `{ ok: false, reason: "synthesis_failed" }` from the
  follow-up turn, with one extra `AnswerHistoryRecord` carrying that
  failure result (the persistence contract is unchanged for the answer
  arm).
- `src/modules/answer/AGENTS.md` adds the new test to the integration-
  anchor list (mirroring the pattern in `src/modules/retract/AGENTS.md`'s
  "Tests" section) and the chaining sentence makes clear the behavior is
  anchored, not aspirational.
- `pnpm test` and `pnpm typecheck` are green at the project root.
- The run directory contains a brief note recording the chosen follow-up
  query, the seeded envelope id, and the citation marker the scripted
  synthesizer emitted, so the next contributor can see the exact shape
  used to anchor this chain.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T16-09-06-121Z-explorer-ziuopm/` after the
just-landed commit `ca9b429a` ("Surface prior cited answers as a fifth
recall contributor"). The recall side of the answer-history chain is now
anchored by the new `"prior answers surface as recall hits"` describe
block, but the synthesizer's prior-answer chaining — the load-bearing
behavior the personal-assistant claim relies on — is still only
documented in `src/modules/answer/AGENTS.md` and the synthesizer's
`describeHit` switch. The integration-anchor rhythm of the recent
commits (`f34e3714` retract, `1bafc23b` capture→answer→history,
`4385e5da` capture→recall) consistently settled exactly this kind of
gap by adding one focused integration test through the production
agent loop. This task continues that line and closes the last
unanchored chain that the fifth recall contributor opened.

## Initiative

Cross-store personal-assistant seam. The conversational loop should
prove, through the production agent harness, that capture/recall/
answer/retract all chain coherently — including the case where KOTA's
own prior cited answer becomes evidence for a follow-up cited answer.
This task is the answer-then-answer leg of that initiative; with it in
place, every recall source the seam exposes (knowledge, memory,
history, tasks, answer) has at least one end-to-end conversational
chain anchored through `src/conversational-agent-tools.integration.test.ts`.

## Acceptance Evidence

- Diff covering the new positive and negative `describe` arms in
  `src/conversational-agent-tools.integration.test.ts`, the
  `AGENTS.md` updates in the answer module (and recall module if its
  "How a new store joins" example references the chain), and any
  small adjustments to the shared fixture if a follow-up query helper
  is genuinely needed.
- `pnpm test` output showing the new positive and negative arms pass
  alongside the existing capture/recall/answer/retract suites.
- A short note in the run directory recording the seed query, the
  follow-up query, the seeded envelope id, and the synthesizer reply
  used to drive the scripted ModelClient — so a future explorer or
  improver can see the exact citation shape the anchor relies on.
