---
id: task-fold-conformance-decoders-into-mobile-digest-and-a
title: Fold conformance decoders into mobile digest and attention runtime paths
status: done
priority: p3
area: client
summary: Fold the conformance parseDigestResponse and parseAttentionResponse decoders into the mobile clients/mobile/src/daemon/digest.ts and attention.ts runtime paths so a daemon-shipped malformed payload throws at the mobile boundary instead of silently flowing into DigestScreen / AttentionScreen as a typed-but-invalid object.
created_at: 2026-05-03T00:30:17.374Z
updated_at: 2026-05-03T06:59:54.361Z
---

## Problem

The mobile client's `getDigest` and `getAttention` paths are TypeScript
generic casts, not runtime decoders:

- `clients/mobile/src/daemon/digest.ts:88-90` —
  `daemonRequest<DigestResponse>(http, '/api/digest')`.
- `clients/mobile/src/daemon/attention.ts:19-21` —
  `daemonRequest<AttentionResponse>(http, '/api/attention')`.

`daemonRequest` itself just `res.json() as Promise<T>` — no field
validation. If the daemon ships a malformed payload (missing
`queueDelta`, drifted `quiet` value, future field shape), the mobile
UI silently coerces it and crashes downstream when `DigestScreen`
reads `digest.data.quiet` or iterates `digest.data.builderCommits`.

The mobile per-store seams are already strict-decoded in production:

- `clients/mobile/src/daemon/recall.ts:89` —
  `parseRecallSearchResponse(parsed)`.
- `clients/mobile/src/daemon/capture.ts:129` — `parseCaptureResult(parsed)`.
- `clients/mobile/src/daemon/retract.ts` — `parseRetractResult`.
- `clients/mobile/src/daemon/answer.ts` — `parseAnswerResult` and friends.
- `clients/mobile/src/daemon/knowledge.ts` /
  `memory.ts` / `history.ts` / `tasks.ts` — per-store
  `parse*SearchResponse`.

Digest and attention are the asymmetric exceptions. macOS already
strict-decodes both via Swift `Codable`
(`clients/macos/Sources/KotaMenuBar/Daemon/DigestModels.swift:9-93`,
`AttentionModels.swift`). The conformance fixture suite already covers
the typed parsers: `clients/conformance/decoders.ts` defines
`parseDigestResponse` and `parseAttentionResponse`, and the mobile Jest
suite already runs them through the byte-identical fixture under
`clients/mobile/src/__tests__/__fixtures__/decoders.ts` —
the production code path just does not call them.

This was surfaced by the digest fan-out consolidation review on
2026-05-03 (`.kota/runs/2026-05-03T00-20-56-261Z-builder-2tvq2p/
digest-consolidation/verdict.md` §3 and §8).

The parallel web-side asymmetry (web `apiJson<DigestResponse>` and
`apiJson<AttentionResponse>`) is already named by the existing follow-up
`task-fold-conformance-decoders-into-web-client-runtime-`. This task is
its mobile-side mirror.

## Desired Outcome

The mobile client's production `getDigest` and `getAttention` paths
strict-decode the daemon response through the same conformance decoders
the test suite already exercises. A daemon response with a missing or
drifted field throws loudly at the mobile boundary — matching macOS
Codable strict-decode and the mobile per-store search seams' existing
strict-decode posture — instead of silently flowing into the UI as a
typed-but-invalid object.

Concretely:

- `clients/mobile/src/daemon/digest.ts` runs `parseDigestResponse` on
  the daemon response.
- `clients/mobile/src/daemon/attention.ts` runs `parseAttentionResponse`.
- The decoders live in one shared location consumed by both
  `clients/conformance/contract-fixture.json` tests and the mobile
  production runtime — no duplicated TypeScript copy.
- `DigestScreen` and `AttentionScreen` keep rendering the existing
  loading / error / body branches; a decoder throw surfaces as
  `digestError` / `attentionError` through the existing context state.

## Constraints

- One canonical decoder per surface — the conformance file or a
  successor location, but not two. Do not fork a second
  `parseDigestResponse` inside `clients/mobile/src/daemon/`.
- Preserve strict decoding: malformed payloads must throw at the
  boundary, surfacing as the screen's existing `digestError` /
  `attentionError` state.
- Reuse the same conformance decoders the mobile Jest fixture suite
  already exercises (`clients/mobile/src/__tests__/__fixtures__/
  decoders.ts` is byte-identical to the canonical
  `clients/conformance/decoders.ts`); do not introduce a third TS copy.
- Do not regress macOS — it already strict-decodes via Swift Codable
  and must stay that way.
- Do not change the daemon wire shape; this is a client-side change.
- Do not regress the web client. The parallel
  `task-fold-conformance-decoders-into-web-client-runtime-` is the
  right place for the web-side fix; this task is mobile-only.

## Done When

1. **Decoder reuse.** `clients/mobile/src/daemon/digest.ts` and
   `attention.ts` call into `parseDigestResponse` and
   `parseAttentionResponse` from the shared conformance decoders. No
   duplicate TypeScript decoder for the same surface.
2. **Mobile boundary throws on drift.** A unit test under
   `clients/mobile/src/__tests__/` mocks `daemonRequest` returning an
   object with a missing required field (e.g. no `queueDelta`) and
   asserts `getDigest(...)` rejects. Same shape for `getAttention(...)`
   with a malformed `data.items[]` entry.
3. **Existing error-state UI still renders.** `DigestScreen`'s
   `digestError` branch and `AttentionScreen`'s `attentionError`
   branch render the decoder's error message in the existing
   destructive style (offline banner / error box / Retry button).
4. **No macOS regression.** macOS Swift conformance + unit suites stay
   green.
5. **Strict-types-policy not loosened.** No new `as unknown` /
   `Record<string, unknown>` introductions outside the boundary
   parser; existing baseline must not regress.
6. **Conformance suite unchanged or stricter.** The mobile Jest
   `__tests__/__fixtures__/decoders.test-cases.ts` continues to pass;
   do not weaken the assertions.

## Source / Intent

Surfaced by the digest fan-out consolidation review
(`.kota/runs/2026-05-03T00-20-56-261Z-builder-2tvq2p/
digest-consolidation/verdict.md`). Mobile per-store search seams already
strict-decode in production; mobile digest and attention are the
asymmetric exceptions. The consolidation review accepted this as
not-a-bug-today (the conformance test catches drift before it ships)
but flagged the runtime posture upgrade as the right next step. Keep
the change scoped to the mobile client; do not invent a parallel schema
mechanism. The web-side mirror is already filed as
`task-fold-conformance-decoders-into-web-client-runtime-`.

## Initiative

N/A - scoped maintenance: tighten the mobile client's runtime posture
on the two asymmetric pull surfaces (digest, attention) so the three
operator-facing visual clients (web, mobile, macOS) speak the same
strict-decode contract on every cross-client read seam.

## Acceptance Evidence

- A focused unit test under `clients/mobile/src/__tests__/` that mocks
  the HTTP layer returning a malformed digest envelope (e.g. missing
  `queueDelta`) and asserts `getDigest(...)` rejects with the
  conformance decoder's error class. Same shape for the attention
  surface.
- `pnpm --filter @kota/mobile test` and `pnpm --filter @kota/mobile typecheck`
  green, captured to a run-directory transcript.
- The `DigestScreen` (or another screen test) exercising the
  decoder-throw path through the React context's `digestError` state,
  asserting the error UI renders.
