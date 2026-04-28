---
id: task-anchor-capture-then-cited-answer-chain-with-one-en
title: Anchor capture-then-cited-answer chain with one end-to-end pipeline test
status: done
priority: p1
area: architecture
summary: Add one top-level integration test that boots the cross-store capture, recall, answer, and answer-history route handlers against the same in-process stores; captures content, asks an answer query that should match the just-captured content, and asserts the synthesized answer cites the captured record and the cited answer surfaces in answer-history — closing the last gap between the capture↔recall pipeline test (offline keyword-only) and the recall→answer→history pipeline test (synthetic recall contributors).
created_at: 2026-04-28T07:56:49.053Z
updated_at: 2026-04-28T08:09:32.821Z
---

## Problem

The four cross-store seams that make up the KOTA personal-assistant
primary flow are now individually anchored, but no single integration
test exercises all four against the same backing stores:

- `src/capture-pipeline.integration.test.ts` exercises the production
  `createCaptureRouteHandler` against real `MemoryStore`, `KnowledgeStore`,
  a tasks queue root, and an inbox directory. It stops at "the
  contributor wrote the record"; it never reads the record back through
  any other seam.

- `src/capture-recall-pipeline.integration.test.ts` (just shipped)
  closes capture↔recall: it boots both route handlers against shared
  real stores and asserts every captured record surfaces in recall under
  the matching `RecallSource`. It never drives `POST /api/answer` or
  asserts anything about citation resolution or answer-history persistence.

- `src/recall-answer-pipeline.integration.test.ts` exercises the
  production `createRecallRouteHandler`, `createAnswerRouteHandler`, and
  `createAnswerHistoryRouteHandler` *together*, but feeds the recall
  seam with hand-crafted `RecallContributor`s that return synthetic
  `RawRecallEntry` piles. It never exercises the real first-party
  recall contributors against the same backing stores capture writes
  to, so no protocol drift between capture writers and answer
  citation resolution can fail this test.

So today, a wire drift along the full chain would land green: e.g.
capture writes a memory record under one slug shape, recall surfaces it,
the synthesizer produces a citation referencing that slug, but the
answer route's citation parser resolves the citation to a different
identifier shape than the one the synthesizer received in
`SynthesisInput.snippets`; or capture writes a knowledge entry whose
preview matches the recall query, but the answer-history record's
`citations[].source` field gets desynced from the recall hit's `source`
literal because the answer module computes citation source independently.
Five operator surfaces (Telegram, web, macOS, mobile, Slack) consume
the entire chain end-to-end through `KotaClient.capture`,
`KotaClient.recall`, `KotaClient.answer`, and
`KotaClient.answerHistory`; the user-visible "I just captured this and
the answer doesn't cite it" or "the answer cited it but answer-history
shows a different citation" regressions would only surface at runtime
against a live operator.

The capture→answer coupling is not just incidental. The cited-answer
seam is *defined* on top of the cross-store recall seam: every citation
in an `AnswerResult` is a `RecallHit` the recall seam returned to the
synthesizer. Persisting the cited answer through
`createAnswerHistoryRouteHandler` is similarly defined on the same
`AnswerResult` shape. So the chain of writers and readers is a single
pipeline whose protocol invariants — `RecallSource` literals,
identifier shapes, citation indexing — are load-bearing across all four
seams. The two existing pipeline tests anchor halves of that chain;
neither anchors the full chain.

## Desired Outcome

One new top-level integration test under `src/` boots the production
capture, recall, answer, and answer-history route handlers against the
same in-process backing stores, captures content, drives an answer
query that should match the captured content, and asserts the
synthesized answer cites the captured record under the right
`RecallSource` and identifier, and the cited answer is then visible
through the answer-history seam:

- All four route handlers (`createCaptureRouteHandler`,
  `createRecallRouteHandler`, `createAnswerRouteHandler`,
  `createAnswerHistoryRouteHandler`) are wired into one in-process
  HTTP host and called through the production `DaemonControlClient`
  namespaces (`capture`, `recall`, `answer`, `answerHistory`) so the
  test asserts the same wire shapes channel surfaces consume.
- The capture side is built from the four real first-party contributors
  (`createMemoryContributor`, `createKnowledgeContributor`,
  `createTasksContributor`, `createInboxContributor`) wired against
  shared `MemoryStore`, `KnowledgeStore`, a temp tasks queue root, and
  a temp inbox directory.
- The recall side is built from the four real recall contributors in
  `src/modules/recall/contributors.ts` wired against the same
  `MemoryProvider`, `KnowledgeProvider`, repo-tasks provider, plus a
  history provider stub (history isn't fed by capture; the stub
  returns empty so recall's history source contributes nothing
  without destabilizing the per-source merge).
- The answer side is wired through `AnswerProviderImpl` configured
  with an in-process recall seam that re-reads the production recall
  route over the local HTTP host, plus a deterministic in-process
  synthesizer stub that returns a fixed cited reply referencing the
  recall snippet indices it received.
- The answer-history side is wired through the production
  `DiskAnswerHistoryStore` against a temp project root resolved by
  `answerHistoryRootForProject`.
- The classifier and the synthesizer are deterministic in-process
  stubs; the test never calls a real model.
- Recall and the recall-feeding answer path run offline. Each provider
  is configured so `supportsSemanticSearch()` returns `false`; the
  recall contributors must reach a result through their keyword-
  fallback path. No fake embedding endpoint, no test-only mode toggles.

The new test must prove the chain end-to-end:

- For each of `memory`, `knowledge`, `tasks`: capture writes a piece
  of content via `POST /api/capture` with an explicit `target`, then
  a follow-up `POST /api/answer` query whose terms match the
  captured content returns an `AnswerResult.kind === "ok"` whose
  `citations` array includes at least one entry whose `source`
  matches the capture target and whose typed identifier resolves to
  the just-written record.
- After each successful answer, `GET /api/answer-history` (or the
  production `KotaClient.answerHistory` `list`/`get` namespace) returns
  the just-recorded `AnswerHistoryRecord`, its `citations` array
  matches the `AnswerResult.citations` exactly (same `source`, same
  identifier shapes, same ordering, same indices), and the persisted
  query echoes the original question.
- For `inbox`: capture writes the file, but a follow-up answer query
  on the same content returns `kind === "no_recall"` (or returns an
  ok answer whose `citations` does not include any inbox-derived hit),
  explicitly anchoring that the capture-superset-of-recall invariant
  propagates into the cited-answer seam.
- The test exercises one classifier `AMBIGUOUS` arm and one synthesizer
  failure arm so both documented failure envelopes flow through the
  same wire shapes the success arms use, and neither writes a stray
  answer-history record on failure.

## Constraints

- One mechanism. Drive the same route handlers, providers, and client
  namespaces real operator surfaces use; do not introduce a parallel
  HTTP shim, a second daemon-control protocol, a "test-only" answer
  or capture route, or a test-only flag on a production type.
- The classifier and synthesizer are deterministic in-process stubs;
  do not call a real model.
- Recall and the recall-feeding answer path run offline. Configure each
  provider so `supportsSemanticSearch()` returns `false`; the recall
  contributors must reach a result through the keyword-fallback path.
  Do not stand up a fake embedding endpoint, do not introduce a "recall
  test mode" toggle.
- The answer seam reads recall results through its production recall
  seam adapter (`AnswerRecallSeam`). The test wires that adapter to the
  same in-process HTTP host the rest of the chain uses, so a drift
  between recall's response shape and the answer seam's recall
  consumption fails this test.
- The answer-history seam uses the production `DiskAnswerHistoryStore`
  rooted at a temp project directory. Do not introduce an in-memory
  test sink unless `DiskAnswerHistoryStore` is itself impractical to
  reach from this test, and even then prefer the production
  `AnswerHistorySink` interface so the wire shape stays honest.
- The test is a single new file under `src/` named per the existing
  naming convention so `src/root-layout.test.ts` accepts it without an
  allowlist edit (e.g. `capture-answer-pipeline.integration.test.ts`).
- The test must not mutate any directory outside its temp roots
  (project root, inbox dir, tasks queue dir, answer-history root). It
  must clean up on `afterAll`.
- No production code may grow a test-only flag, hook, or override.
  Reach the seam through the dependency-injection paths that already
  exist (`CaptureProvider.register()`, recall contributor registration,
  route handler factories, classifier injection, synthesizer
  injection, answer-history sink injection, provider configuration).
- Answer queries must be content-derived, not identifier-derived:
  assert that querying for words from the captured payload returns an
  answer whose citations include the just-written record, rather than
  querying for the identifier directly. This is what proves the
  writer-reader-synthesizer-historian chain.
- If discovery shows a real protocol drift between capture writers,
  recall contributors, the answer citation resolver, or the
  answer-history record shape, fix the drift in the owning module
  rather than working around it in the test. The test exists to keep
  the chain honest, not to encode an existing bug.

## Done When

- A new `src/capture-answer-pipeline.integration.test.ts` exists at the
  integration test tier described in `src/AGENTS.md` and is accepted by
  `src/root-layout.test.ts` without an allowlist edit.
- The test boots one in-process HTTP host that mounts
  `createCaptureRouteHandler`, `createRecallRouteHandler`,
  `createAnswerRouteHandler`, and `createAnswerHistoryRouteHandler`
  against shared real `MemoryStore`, `KnowledgeStore`, a temp tasks
  queue root, a temp inbox directory, and a temp answer-history root.
- The test exercises every recall-readable `CaptureTarget` literal
  end-to-end: capture to `memory`, `knowledge`, `tasks` each produces
  a `CaptureRecord` whose identifier resolves to the just-written
  record *and* surfaces as a citation in a follow-up
  `POST /api/answer` whose query matches the captured content, with
  the citation's `source` matching the capture target.
- After each successful answer, the answer-history seam returns the
  just-recorded record with citations matching the
  `AnswerResult.citations` exactly (same source, same identifier
  shape, same ordering).
- The test asserts `inbox` capture writes the inbox file but is *not*
  surfaced as a citation in any follow-up answer for the same content,
  explicitly anchoring the capture-superset-of-recall invariant in
  the cited-answer seam.
- The test exercises one classifier `AMBIGUOUS` arm and one
  synthesizer failure arm so the documented failure envelopes flow
  alongside the success arms in the same chain, and neither writes a
  stray answer-history record on failure.
- The test runs offline (semantic search disabled, no real model calls).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Deliberately breaking one chain invariant (e.g. swapping the memory
  contributor's slug shape, dropping the recall keyword fallback,
  letting inbox text reach a citation, or desyncing
  `AnswerResult.citations[].source` from the recall hit's source)
  makes this test fail.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T07-54-20-911Z-explorer-ticbzg/` immediately
after the capture↔recall anchor task
(`task-anchor-capture-then-recall-chain-with-one-end-to-e`,
completed 2026-04-28 in commit `4385e5da`) shipped. The capture↔recall
test exercises capture writers and recall readers against the same
backing stores; the recall→answer→history test exercises the
reader-synthesizer-historian chain but with synthetic recall
contributors. Neither anchors the full
capture-write→recall-read→synthesize-with-citation→persist-history
chain against the same backing stores, so a schema drift between the
capture writers and the answer seam's citation resolution — exactly
the protocol drift the per-half tests were designed to catch when
combined — would land green today. Five operator surfaces (Telegram,
web, macOS, mobile, Slack) all consume this chain through
`KotaClient.{capture,recall,answer,answerHistory}`; the gap closes
before any further surface fan-out lands on top of any of the four
seams.

## Initiative

Module-first, core-shrinking architecture: load-bearing seams that fan
out across operator surfaces are anchored by single end-to-end
integration tests exercising the same route handlers, providers, and
client namespaces real surfaces use, so per-module tests plus one
cross-module pipeline test catch protocol drift before it reaches a
client. This task closes the last writer-reader-synthesizer-historian
chain anchor across the cross-store capture, recall, answer, and
answer-history seams so the four shipped pipelines form one
continuously verified production pipeline rather than two halves with
an un-tested seam between them.

## Acceptance Evidence

- Diff adding `src/capture-answer-pipeline.integration.test.ts` plus
  any small fixture helpers it needs (no production-code changes
  unless a real chain drift was discovered and fixed).
- `pnpm test src/capture-answer-pipeline.integration.test.ts`
  transcript showing every recall-readable `CaptureTarget` round-trip
  into a citation in the answer response and into the matching
  answer-history record, the `inbox`-not-citable assertion passing,
  and both the classifier `AMBIGUOUS` and synthesizer failure arms
  flowing through unchanged with no stray history record.
- A short snippet showing a deliberate one-line break in one chain
  invariant (e.g. swapping `MemoryStore` write key shape, removing
  the recall keyword fallback for one source, letting inbox text
  reach a citation, or desyncing `citations[].source` from the recall
  hit's source) and the matching red test output, demonstrating the
  test catches drift in the chain it claims to anchor.
