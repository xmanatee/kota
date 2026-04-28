---
id: task-add-recall-plus-cited-answer-plus-answer-history-e
title: Add recall plus cited-answer plus answer-history end-to-end integration test
status: done
priority: p2
area: architecture
summary: Anchor the recently shipped cross-store recall, cited-answer, and answer-history fan-out with one top-level integration test that boots the daemon over seeded knowledge/memory/history/tasks contributors, exercises POST /recall, POST /answer, GET /api/answers, and GET /api/answers/:id end-to-end, and asserts the typed wire shapes so subtle protocol drift across the Telegram, web, macOS, and mobile surfaces cannot land silently.
created_at: 2026-04-28T02:35:15.699Z
updated_at: 2026-04-28T02:46:48.783Z
---

## Problem

The last ~25 commits shipped the cross-store recall seam, the cited-answer
seam on top of it, and the typed answer-history store, then fanned each one
out into Telegram, web, macOS, and mobile surfaces. Every surface consumes
the same daemon control routes — `POST /recall`, `POST /answer`,
`GET /api/answers`, `GET /api/answers/:id` — through `KotaClient.recall`,
`KotaClient.answer`, and `KotaClient.answer.log/show`.

Coverage today is per-module: `src/modules/recall/routes.test.ts` exercises
the recall route handler, `src/modules/answer/routes.test.ts` exercises the
answer route handler, and `src/modules/answer/answer-history-store.test.ts`
covers the store in isolation. There is no top-level test that boots the
daemon, registers real contributors backed by seeded knowledge / memory /
history / tasks data, and walks the full pipeline through HTTP. Existing
peer tests like `src/memory-pipeline.integration.test.ts` and
`src/server-e2e.integration.test.ts` show this is the established pattern
for cross-module pipeline coverage; the recall+answer+answer-history
pipeline is the largest visible gap left by the recent fan-out.

The four operator clients consume the same wire shapes — discriminated
`RecallResult` / `AnswerResult` / answer-history records with typed
`source` and resolving citation ids. A subtle drift in any of these (e.g.
synthesis returns a marker `source` outside `RecallSource`, citations stop
deduplicating, the persisted record omits the `RecallHit[]` shown to the
synthesizer, the GET routes change pagination semantics, the recall seam
silently changes its tie-break order, etc.) would compile and pass per-
module tests yet break Telegram, web, macOS, and mobile in lockstep with
no signal until an operator hits it.

## Desired Outcome

One top-level integration test exercises the full recall → answer →
answer-history pipeline through the daemon HTTP surface against seeded
contributors:

- The test boots a daemon (or a thin in-process equivalent that wires the
  real `createRecallRouteHandler`, `createAnswerRouteHandler`, and answer-
  history routes the same way the server does) into a temporary project
  state root.
- Knowledge, memory, history, and tasks stores are seeded with a small,
  deterministic corpus designed so a chosen query has at least one hit per
  source and a known global ranking.
- `POST /recall` returns ranked, source-tagged hits. The test asserts that
  every `RecallSource` literal appears, scores are normalized into
  `[0, 1]`, the deterministic tie-break order from
  `RECALL_SOURCE_ORDER` holds, and discriminated `RecallHit` arms decode
  cleanly against the `KotaClient.recall` types.
- `POST /answer` returns a discriminated `AnswerResult` whose success arm
  carries `[source:id]` markers in the prose, citations that
  resolve back to a strict subset of the recall hits the synthesizer was
  shown, and at most `ANSWER_MAX_CITATIONS`. The synthesizer call is
  controlled in-process so the response is deterministic.
- After the answer call, `GET /api/answers` lists exactly one new typed
  record and `GET /api/answers/:id` returns the full envelope including
  the persisted `RecallHit[]` and citations. Both routes echo the same
  typed shapes a client would consume.
- A representative failure path (synthesis returns an unresolvable marker)
  asserts the documented retry-then-`{ ok: false, reason:
  "synthesis_failed" }` behavior and that the failure record still
  appends to answer-history with the recall hits the seam saw.

## Constraints

- One mechanism. The test must drive the same route handlers / client
  namespaces real operator surfaces use; it must not introduce a parallel
  HTTP shim, a second daemon-control protocol, or a "test-only" route.
- The seeded corpus, the synthesizer stand-in, and the assertions all
  live in one new file under `src/`, named per the existing naming
  convention (e.g. `recall-answer-pipeline.integration.test.ts`) so
  `src/root-layout.test.ts` accepts it without an allowlist edit.
- The synthesizer is replaced with a deterministic in-process stub that
  emits known `[source:id]` markers; do not call a real model in CI.
- No production code may grow a test-only flag, hook, or override.
  Reach the seam through dependency injection paths that already exist
  (provider registry, route handler factories) or through configuration
  surfaces shipped with the modules.
- Persisted records read through `KotaClient.answer.log` /
  `KotaClient.answer.show` so the test asserts the same client surface
  Telegram / web / macOS / mobile see, not the on-disk JSON files.
- The test runs under `pnpm test` without external network access and
  cleans up its temp project root.

## Done When

- `src/recall-answer-pipeline.integration.test.ts` exists, covers the
  success and the synthesis-failure paths described above, and passes
  under `pnpm test`.
- The success path asserts: at least one hit per `RecallSource` literal,
  normalized scores in `[0, 1]`, deterministic source-then-id tie-break,
  citations resolving to a strict subset of the recall hits, citation
  count capped at `ANSWER_MAX_CITATIONS`, and one new answer-history
  record visible through `KotaClient.answer.log` / `show`.
- The failure path asserts the retry-then-`synthesis_failed` envelope
  is returned and the failed-call record still appends with the seen
  recall hits.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Deliberately breaking one wire invariant (e.g. dropping the
  normalization step in the recall seam, or removing the citation
  validation step in the answer seam) makes this test fail.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T02-30-00-634Z-explorer-aalgcb/` after the recent
recall + cited-answer + answer-history fan-out cluster (commits
`09d60ce3` `082c565f` `21bdc367` `daa25e07` `8e263891` and the matching
Telegram, web, macOS, and mobile follow-ups) ended with no top-level
test exercising the pipeline through the daemon HTTP surface. With four
operator clients now consuming the same wire shapes, drift in any of
those shapes would land silently.

## Initiative

Module-first, core-shrinking architecture: load-bearing seams that fan
out across operator surfaces are anchored by a single end-to-end
integration test exercising the same route handlers and client
namespaces real surfaces use, so per-module tests plus one cross-module
pipeline test catch protocol drift before it reaches a client.

## Acceptance Evidence

- Diff adding `src/recall-answer-pipeline.integration.test.ts` plus any
  small fixture helpers it needs.
- `pnpm test src/recall-answer-pipeline.integration.test.ts` transcript
  showing the success and failure paths passing.
- A short snippet showing a deliberate one-line break in the recall
  normalization or answer citation-validation paths and the matching
  red test output, demonstrating the test catches drift in the seams
  it claims to anchor.
