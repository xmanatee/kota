---
id: task-extend-cross-client-conformance-and-thin-client-de
title: Extend cross-client conformance and thin-client decoders to the answer recall arm
status: done
priority: p1
area: architecture
summary: Extend the cross-client conformance fixture and thin-client decoders so the daemon's source "answer" RecallHit arm and AnswerCitation source decode on every visual surface (mobile, web, macOS).
created_at: 2026-05-02T22:09:39.207Z
updated_at: 2026-05-03T01:06:47.142Z
---

## Problem

The daemon's `RecallSource` is closed over
`knowledge | memory | history | tasks | answer` (commit `ca9b429a`,
2026-04-28 — surfaces prior cited answers as a fifth recall
contributor). The daemon's `AnswerCitation.source` is typed
`RecallSource`, so a successful answer envelope can carry citations
of the form `{ source: "answer", id: <prior-answer-id> }`, and a
recall fan-out can return a `RecallAnswerHit` with `source: "answer"`.

The cross-client conformance gate (`4d8f2626`, 2026-05-02) extended
the fixture and decoder catalog to "every cross-store and
digest/attention/voice surface" but did not add a positive arm for
either `RecallAnswerHit` or `AnswerCitation { source: "answer" }`.
Every visual thin client therefore rejects the closed-set arm:

- `clients/mobile/src/daemon/answer.ts:66-71` — `ANSWER_CITATION_SOURCES`
  is `['knowledge', 'memory', 'history', 'tasks']`. A citation with
  `source: "answer"` throws `Invalid answer citation: missing required
  fields`.
- `clients/mobile/src/daemon/recall.ts:9` — `RecallSource` lacks
  `'answer'`; `RecallHit` union has no `RecallAnswerHit` arm; the
  switch in `parseRecallHit` would throw on `source: "answer"`.
- `clients/web/src/api/types.ts:382` — `RecallSource = "knowledge" |
  "memory" | "history" | "tasks"` (missing `"answer"`); `RecallHit`
  union (line 420-424) lacks `RecallAnswerHit`.
- `clients/macos/Sources/KotaMenuBar/Daemon/RecallModels.swift:30-72` —
  `RecallHit` enum has only the four arms; `default:` throws
  `DecodingError.dataCorruptedError("Unknown recall hit source:
  answer")`. The macOS `AnswerCitation` struct stores `source: String`
  so it parses, but cannot be rendered through
  `renderAnswerCitationsPlain` because the resulting hit lookup
  misses the answer-source `RecallHit` the macOS enum cannot decode.
- `clients/conformance/decoders.ts:148-193, 226-231` and
  `contract-fixture.json` — same gaps; the gate has no positive arm
  exercising `source: "answer"` on either `RecallHit` or
  `AnswerCitation`, so the drift was not caught at conformance time.

The first time a synthesizer cites a prior cited answer (or recall
surfaces a `RecallAnswerHit`), the visual thin clients throw at
decode time and render a generic failure banner instead of the
operator-meaningful cited reply.

The in-process surfaces (CLI, Slack, Telegram, agent tool) consume
`KotaClient.answer.*` and share the strict TS types from
`#core/server/kota-client.js`, so they are already correct.

## Desired Outcome

A successful `POST /api/answer` whose envelope carries either a
`RecallAnswerHit` in `hits` or an `AnswerCitation { source: "answer" }`
in `citations` decodes cleanly on every visual thin client (mobile,
web, macOS) and renders in the same shape as the four already-supported
sources. The cross-client conformance gate fails when either arm
regresses.

## Constraints

- Mirror the daemon's `RecallAnswerHit` shape verbatim
  (`{ source: "answer", score, id, query, preview, citationCount,
  createdAt, result: { ok: true } | { ok: false, reason } }`) — no
  per-client field renames, no flattening, no nullable fields.
- Mirror the closed citation source set verbatim — extend the per-
  client `RecallSource` union and the per-client
  `ANSWER_CITATION_SOURCES` list together; do not split the closed
  set across surfaces.
- Strict decode at the boundary. An unknown discriminator (unknown
  source, unknown reason, unknown target) must still throw on every
  surface; the negative arms in the conformance fixture must stay
  green and a new negative arm covering the post-fix closed set
  should be added.
- One canonical change. The conformance fixture, the canonical TS
  catalog (`clients/conformance/decoders.ts`), the byte-identical
  mobile copy under `clients/mobile/src/__tests__/__fixtures__/`,
  and the macOS `Bundle.module` copy must move together so the
  cross-client gate stays green in one commit.
- No backwards-compatibility shim. The four-arm decoders are simply
  out of date with the daemon contract; replace them with the
  five-arm shape rather than threading a feature flag.

## Done When

1. The conformance fixture (`clients/conformance/contract-fixture.json`)
   gains a positive arm under `recall.successMixedSources` (or a new
   peer arm) that includes a `RecallAnswerHit`, and a positive arm
   under `answer.success` (or a new peer arm) whose `citations`
   include `{ source: "answer", id: ... }` and whose `hits` include
   the matching `RecallAnswerHit`.
2. `clients/conformance/decoders.ts` gains the
   `RecallAnswerHit` type, the matching switch arm in `parseRecallHit`,
   and an updated `parseAnswerCitation` that accepts
   `source: "answer"`. The byte-identical mobile fixture copy is
   refreshed in the same change.
3. `clients/mobile/src/daemon/recall.ts` gains the `RecallAnswerHit`
   arm and a matching `parseRecallHit` switch case;
   `clients/mobile/src/daemon/answer.ts` updates
   `ANSWER_CITATION_SOURCES` to the five-source closed set.
4. `clients/web/src/api/types.ts` extends `RecallSource` to the
   five-source closed set and adds `RecallAnswerHit` to the
   `RecallHit` union (plus any matching parser/renderer touch the web
   surface needs to render the new hit shape).
5. `clients/macos/Sources/KotaMenuBar/Daemon/RecallModels.swift`
   extends the `RecallHit` enum with an `.answer` case carrying the
   `RecallAnswerHit` payload, plus the matching `init(from:)` switch
   arm, `source` / `id` / `score` / `describe` accessors, and a
   matching `XCTestCase` covering the new positive arm and a negative
   "unknown answer-result reason" arm.
6. The cross-client conformance gate (web Vitest + mobile Jest +
   macOS Swift Codable) goes red without these changes and green
   after them. The new positive arms appear in each runtime's
   conformance log.
7. A new negative arm covering the post-fix closed set
   (`negative_unknownSource: { ..., source: "future_source" }`)
   stays explicitly rejected on every surface, so the closed-set
   discipline is load-bearing rather than accidentally lax.

## Source / Intent

Surfaced by the answer-fan-out consolidation review run
`.kota/runs/2026-05-02T21-58-27-752Z-builder-etz2oj/answer-consolidation/`
(see `verdict.md` §2 "Cross-client capability contract"). The
runtime probe (`contract-probe.json`) pinned the daemon's full closed
citation source set with a positive arm carrying both
`source: "knowledge"` and `source: "answer"` citations, exposing the
gap in the visual thin clients.

## Initiative

Cross-client coherence: the cross-client conformance gate is the
single mechanism that keeps the visual surfaces (web, mobile, macOS)
in lockstep with the daemon contract. Letting the `answer` arm
silently bypass the gate erodes the single-source-of-truth posture
the gate exists to enforce.

## Acceptance Evidence

- Updated conformance fixture and decoder catalog committed under
  `clients/conformance/` with byte-identical mobile copies.
- Conformance suite logs (web Vitest, mobile Jest, macOS Swift
  XCTest) showing the new positive `source: "answer"` arms green.
- Per-client decoder + type updates landed under
  `clients/mobile/src/daemon/{recall,answer}.ts`,
  `clients/web/src/api/types.ts`, and
  `clients/macos/Sources/KotaMenuBar/Daemon/RecallModels.swift`.
- A short transcript or runtime probe that re-runs the
  consolidation's `probe-contract.mjs` and shows the same six-arm
  envelope decoded successfully through every per-client decoder
  (or an updated probe artifact under `.kota/runs/<run-id>/`
  proving the parity).
