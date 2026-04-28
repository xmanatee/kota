---
id: task-anchor-capture-then-recall-chain-with-one-end-to-e
title: Anchor capture-then-recall chain with one end-to-end integration test against shared real stores
status: done
priority: p1
area: architecture
summary: Add one top-level integration test that boots the cross-store capture and recall route handlers against the same in-process MemoryStore, KnowledgeStore, and tasks/inbox project root, captures content via POST /api/capture for every CaptureTarget, then drives POST /api/recall through the production DaemonControlClient and asserts each captured item surfaces in the matching RecallSource hits — closing the gap between the capture-pipeline test (write-only) and the recall-answer-pipeline test (synthetic-data read-only) so a schema drift between capture writers and recall contributors fails loudly.
created_at: 2026-04-28T07:22:39.275Z
updated_at: 2026-04-28T07:33:00.146Z
---

## Problem

The cross-store capture seam and the cross-store recall seam are now both
shipped and individually anchored:

- `src/capture-pipeline.integration.test.ts` exercises the production
  `createCaptureRouteHandler` against real `MemoryStore`, `KnowledgeStore`,
  a tasks queue root, and an inbox directory, asserting every
  `CaptureRecord` arm and every documented failure arm. It stops at "the
  contributor wrote the record"; it never reads the written record back
  through any other seam.

- `src/recall-answer-pipeline.integration.test.ts` exercises the production
  `createRecallRouteHandler` and friends, but it feeds the seam with
  *hand-crafted* `RecallContributor`s that return synthetic
  `RawRecallEntry` piles. It never exercises the real
  `createMemoryContributor` / `createKnowledgeContributor` /
  `createTasksContributor` / `createHistoryContributor` adapters from
  `src/modules/recall/contributors.ts` against the same backing stores
  capture writes to.

So today, a wire drift between the capture writers and the recall
contributors of the same store would land green: e.g. capture writes a
memory record under one slug shape and recall queries the store with a
different slug shape, capture creates a knowledge entry whose `content`
field doesn't match the field the recall contributor reads, capture
creates a task file whose semantic+keyword search index can't see it, or
capture writes to inbox while recall silently de-prioritizes inbox below
the visibility threshold. Five operator surfaces (Telegram, web, macOS,
mobile, Slack) consume both seams; per-module tests would stay green
while the user-visible "I just captured this and now I can't recall it"
regression would only surface at runtime against a live operator.

The capture↔recall coupling is not just incidental: the capture
contributors and the recall contributors are deliberate paired writers
and readers of the same `MemoryStore` / `KnowledgeStore` / repo-tasks
store, and the `RecallSource` literal set (`memory`, `knowledge`, `tasks`,
`history`) overlaps with three of the four `CaptureTarget` literals
(`memory`, `knowledge`, `tasks`, `inbox`). The asymmetry — capture writes
to `inbox`, recall does not read `inbox` — is itself a load-bearing
invariant nothing currently asserts.

## Desired Outcome

One new top-level integration test under `src/` boots the production
capture and recall route handlers against the same in-process backing
stores, captures content for every `CaptureTarget`, then recalls through
queries that should match the captured content and asserts each captured
item surfaces with the right `source` and identifier in the recall
response:

- Both `createCaptureRouteHandler` and `createRecallRouteHandler` are
  wired into one in-process HTTP host and called through the production
  `DaemonControlClient.capture` and `DaemonControlClient.recall` so the
  test asserts the same wire shapes channel surfaces consume.
- The capture side is built from the four real first-party contributors
  (`createMemoryContributor`, `createKnowledgeContributor`,
  `createTasksContributor`, `createInboxContributor`) wired against
  shared `MemoryStore`, `KnowledgeStore`, a temp tasks queue root, and a
  temp inbox directory. The classifier is a deterministic in-process
  stub.
- The recall side is built from the four real recall contributors in
  `src/modules/recall/contributors.ts` wired against the same
  `MemoryProvider`, `KnowledgeProvider`, repo-tasks provider, and a
  history provider stub (history isn't fed by capture; the stub returns
  empty so recall's history source contributes nothing without
  destabilizing the per-source merge).
- The test runs offline. The recall path uses each provider's keyword-
  fallback (`provider.supportsSemanticSearch() === false`) so no
  embeddings backend is needed.

The new test must prove the chain end-to-end:

- For each of `memory`, `knowledge`, `tasks`, capture writes a piece of
  content via `POST /api/capture` with an explicit `target`, then a
  follow-up `POST /api/recall` query that should match the captured
  content returns at least one hit whose `source` matches the capture
  target and whose typed identifier resolves to the just-written record.
- Capture to `inbox` produces a `CaptureRecord` arm, and the same content
  is then *not* surfaced by `POST /api/recall` — explicitly anchoring the
  capture-targets-superset-of-recall-sources invariant.
- The same test exercises one ambiguous classifier reply (no `target`
  given, classifier returns `AMBIGUOUS`, no recall query follows because
  no record was written) so the failure-arm payload still flows through
  the same wire shape used by the success arms.
- The test asserts the round-trip sets `RecallSource` correctly per
  source, never confuses one source's identifier shape for another's,
  and never returns the same captured payload under two different
  sources.

## Constraints

- One mechanism. Drive the same route handlers, providers, and client
  namespaces real operator surfaces use; do not introduce a parallel
  HTTP shim, a second daemon-control protocol, a "test-only" capture or
  recall route, or a test-only flag on a production type.
- The classifier is replaced with a deterministic in-process stub; do
  not call a real model.
- Recall runs offline. Configure each provider so
  `supportsSemanticSearch()` returns `false`; the recall contributors
  must reach a result through the keyword-fallback path. Do not stand up
  a fake embedding endpoint, do not introduce a "recall test mode" toggle.
- The test is a single new file under `src/` named per the existing
  naming convention so `src/root-layout.test.ts` accepts it without an
  allowlist edit (e.g. `capture-recall-pipeline.integration.test.ts`).
- The test must not mutate any directory outside its temp roots (project
  root, inbox dir, tasks queue dir). It must clean up on `afterAll`.
- No production code may grow a test-only flag, hook, or override. Reach
  the seam through the dependency-injection paths that already exist
  (`CaptureProvider.register()`, recall contributor registration, route
  handler factories, classifier injection point, provider configuration).
- Recall queries must be content-derived, not identifier-derived: assert
  that querying for words from the captured payload returns a hit whose
  identifier matches the just-written record, rather than querying for
  the identifier directly. This is what proves the writer-reader chain.
- If discovery shows a real protocol drift between capture writers and
  recall contributors today, fix the drift in the owning module rather
  than working around it in the test. The test exists to keep the chain
  honest, not to encode an existing bug.

## Done When

- A new `src/capture-recall-pipeline.integration.test.ts` exists at the
  integration test tier described in `src/AGENTS.md` and is accepted by
  `src/root-layout.test.ts` without an allowlist edit.
- The test boots one in-process HTTP host that mounts both
  `createCaptureRouteHandler` and `createRecallRouteHandler` against
  shared real `MemoryStore`, `KnowledgeStore`, a temp tasks queue root,
  and a temp inbox directory, and drives the chain through the
  production `DaemonControlClient.capture` and `DaemonControlClient.recall`.
- The test exercises every `CaptureTarget` literal end-to-end: capture
  to `memory`, `knowledge`, `tasks` each produces a `CaptureRecord` whose
  identifier resolves to the just-written record *and* surfaces in
  `POST /api/recall` results under the matching `RecallSource` when the
  query matches the captured content.
- The test asserts `inbox` capture writes the inbox file but is *not*
  visible in any `POST /api/recall` result for the same content,
  explicitly anchoring the capture-superset-of-recall invariant.
- The test exercises one classifier `AMBIGUOUS` arm so the documented
  failure envelope flows alongside the success arms in the same chain.
- The test runs offline (semantic search disabled, no real model calls).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Deliberately breaking one chain invariant (e.g. swapping the memory
  contributor's slug shape, dropping the recall keyword fallback, or
  letting the inbox payload reach a recall hit) makes this test fail.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T07-18-44-187Z-explorer-uyhtaa/` immediately after
the capture-pipeline anchor task
(`task-add-capture-pipeline-integration-test-boots-daemon`, completed
2026-04-28 in commit `6ea9007c`) shipped. The capture-pipeline test
exercises capture writers against real backing stores; the
recall-answer-pipeline test exercises recall readers against synthetic
contributors. Neither exercises the writer-reader chain against the
same backing store, so a schema drift between paired contributors —
the exact protocol drift these per-seam tests were designed to catch —
would land green today. Five operator surfaces (Telegram, web, macOS,
mobile, Slack) all depend on this chain; the gap closes before any
further fan-out lands on top of either seam.

## Initiative

Module-first, core-shrinking architecture: load-bearing seams that
fan out across operator surfaces are anchored by single end-to-end
integration tests exercising the same route handlers, providers, and
client namespaces real surfaces use, so per-module tests plus one
cross-module pipeline test catch protocol drift before it reaches a
client. This task closes the writer-reader chain anchor between the two
shipped pipelines so the cross-store capture, recall, answer, and
answer-history seams form one continuously verified production
pipeline rather than four parallel ones with un-tested couplings.

## Acceptance Evidence

- Diff adding `src/capture-recall-pipeline.integration.test.ts` plus any
  small fixture helpers it needs (no production-code changes unless a
  real chain drift was discovered and fixed).
- `pnpm test src/capture-recall-pipeline.integration.test.ts` transcript
  showing every `CaptureTarget` round-trip into the matching
  `RecallSource` hit, the `inbox`-not-recallable assertion passing, and
  the classifier `AMBIGUOUS` arm flowing through unchanged.
- A short snippet showing a deliberate one-line break in one chain
  invariant (e.g. swapping `MemoryStore` write key shape, removing the
  recall keyword fallback for one source, or letting inbox text leak
  into a recall hit) and the matching red test output, demonstrating
  the test catches drift in the chain it claims to anchor.
