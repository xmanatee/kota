---
id: task-fold-conformance-decoders-into-web-client-runtime-
title: Fold conformance decoders into web client runtime api paths
status: done
priority: p3
area: client
summary: Fold the conformance parseCaptureResult / parseRetractResult / parseRecallResult / parseAnswerResult / parseAnswerHistoryShowResult / parseKnowledgeSearchResponse / parseMemorySearchResponse / parseHistorySearchResponse / parseTasksSearchResponse decoders into the web client's production api.* paths so web matches mobile and macOS strict runtime decode.
created_at: 2026-05-03T00:14:37.935Z
updated_at: 2026-05-03T03:39:17.614Z
---

## Problem

The web client's production `api.*` wrappers in
`clients/web/src/api/client.ts` (`api.capture`, `api.retract`,
`api.recall`, `api.answer`, `api.knowledge.search`,
`api.memory.search`, `api.history.search`, `api.tasks.search`,
`api.attention`, `api.digest`, plus the answer-history surfaces) call
`apiJson<T>(...)`, which is a TypeScript type assertion — the runtime
just `JSON.parse`s the body and casts. If a daemon ships a malformed
payload (unknown reason, missing field, drifted discriminator value),
the web UI silently coerces it and crashes downstream when a
component reads a missing property.

Mobile and macOS already strict-decode in production:

- mobile: `clients/mobile/src/daemon/capture.ts` runs `parseCaptureResult`
  on every response; `clients/mobile/src/daemonClient.ts` runs the same
  per-surface parser pattern for recall, answer, knowledge, memory,
  history, tasks. Unknown discriminators throw at the boundary.
- macOS: every `Daemon/*Routes.swift` decodes the response through a
  Swift `Decodable` whose `init(from:)` rejects unknown enum cases via
  `DecodingError.dataCorruptedError`. Same strict posture.

The conformance fixture suite already covers the typed parsers:
`clients/conformance/decoders.ts` defines `parseCaptureResult`,
`parseRetractResult`, `parseRecallResult`, `parseAnswerResult`,
`parseAnswerHistoryShowResult`, `parseAnswerHistoryListResult`,
`parseKnowledgeSearchResponse`, `parseMemorySearchResponse`,
`parseHistorySearchResponse`, `parseTasksSearchResponse`,
`parseAttentionResponse`, `parseDigestResponse`,
`parseVoiceTranscribeResult`, and `parseVoiceFailure`. The web client's
own `clients/web/src/api/contractFixture.test.ts` already exercises these
decoders against the fixture, but the production code path does not call
them.

This was surfaced by the capture fan-out consolidation review on
2026-05-03 (`.kota/runs/2026-05-03T00-02-07-769Z-builder-pr27t6/
capture-consolidation/verdict.md`).

## Desired Outcome

The web client's production `api.*` wrappers strict-decode the daemon
response through the same conformance decoders the test suite already
exercises. A daemon response with an unknown discriminator throws
loudly at the web boundary — same as mobile and macOS today — instead
of silently flowing into the UI as a typed-but-invalid object.

Concretely:

- `api.capture` runs `parseCaptureResult` on the response.
- `api.retract` runs `parseRetractResult`.
- `api.recall` runs `parseRecallResult`.
- `api.answer` runs `parseAnswerResult`.
- `api.knowledge.search`, `.memory.search`, `.history.search`,
  `.tasks.search` each run their matching `parse*SearchResponse`.
- The answer-history list and show endpoints run their matching parsers.
- Attention and digest endpoints run their matching parsers.
- The decoders live in one shared location consumed by both
  `clients/conformance/contract-fixture.json` tests and the web
  production runtime — no duplicated TypeScript copy.

## Constraints

- One canonical decoder per surface — the conformance file or a
  successor location, but not two. Do not fork a second
  `parseCaptureResult` inside `clients/web/`.
- Preserve strict decoding: unknown discriminators must throw the same
  error class the test suite already asserts against (`ContractDecodeError`
  for the conformance decoders).
- React Query / TanStack hooks must surface the decoder throw as the
  query's `error` so existing error-state UI continues to render
  (`capture.isError`, `recall.isError`, etc.). Do not swallow.
- The task-share-or-conformance-test-daemon-wire-contracts-ac umbrella
  (already `done/`) chose test-time conformance as the durable
  mechanism; this task is a focused upgrade of the web-side runtime
  posture, not a re-litigation of that umbrella decision. Keep the
  same `decoders.ts` decoders; do not introduce a parallel runtime
  schema layer.
- Do not regress mobile or macOS — those already strict-decode and
  must stay that way.
- Do not change the daemon wire shape; this is a client-side change.

## Done When

1. **Decoder reuse.** The web client's production `api.*` paths call
   into the same conformance decoders the test suite uses. No duplicate
   TypeScript decoder for the same surface.
2. **Web boundary throws on drift.** A unit test mocks `apiJson`
   returning an object with an unknown `reason` value and asserts the
   web `api.capture` (and at least one other surface — recall or
   knowledge.search) throws at the boundary, surfaced through
   `useMutation` / `useQuery` `error`.
3. **Existing error-state UI still renders.** The `CapturePanel`'s
   `capture.isError` branch and the equivalent recall / answer / panel
   branches render the decoder's error message in the existing
   destructive style.
4. **No mobile or macOS regression.** Mobile Jest and macOS Swift
   conformance + unit suites stay green.
5. **Strict-types-policy not loosened.** No new `as unknown` /
   `Record<string, unknown>` introductions outside the boundary
   parser; existing baseline must not regress.
6. **Conformance suite unchanged or stricter.** The web Vitest
   `contractFixture.test.ts` continues to pass; do not weaken
   the assertions.

## Source / Intent

Surfaced by the capture fan-out consolidation review
(`.kota/runs/2026-05-03T00-02-07-769Z-builder-pr27t6/
capture-consolidation/verdict.md`). Mobile and macOS already
strict-decode in production; web is the asymmetric surface. The
consolidation review accepted this as not-a-bug-today (the conformance
test catches drift before it ships) but flagged the runtime posture
upgrade as the right next step. Keep the change scoped to the web
client; do not invent a parallel schema mechanism.

## Initiative

N/A - scoped maintenance: tighten the web client's runtime posture so
the three operator-facing visual clients (web, mobile, macOS) speak the
same strict-decode contract on every cross-store / cross-search seam.

## Acceptance Evidence

- A focused unit test under `clients/web/src/api/` that mocks the HTTP
  layer returning a malformed `{ ok: false, reason: "future_reason" }`
  capture envelope and asserts `api.capture(...)` rejects with a
  `ContractDecodeError`-shaped throw. Same shape for at least one
  read surface (recall or knowledge.search).
- `pnpm --filter @kota/web test` and `pnpm --filter @kota/web typecheck`
  green, captured to a run-directory transcript.
- The web `CapturePanel` (or another sidebar panel) test exercising
  the decoder-throw path through React Query's error state, asserting
  the destructive-banner copy renders.
