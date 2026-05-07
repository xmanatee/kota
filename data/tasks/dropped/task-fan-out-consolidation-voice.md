---
id: task-fan-out-consolidation-voice
title: Consolidate voice surfaces across clients
status: dropped
priority: p2
area: client
summary: Review the voice surface family across macos, mobile, web, cli for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-07T00:00:00.000Z
---

## Problem

The `voice` capability shipped across 4 client surfaces
(cli, macos, mobile, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `voice`

Surfaces shipped:

- cli
- macos
- mobile
- web

Recently closed fan-out tasks in this batch:

- task-wire-voice-for-web-macos-mobile-clients (macos, closed 2026-04-22T22:19:45.784Z) — Wire voice input and output in macOS and mobile clients
- task-wire-voice-for-web-macos-mobile-clients (mobile, closed 2026-04-22T22:19:45.784Z) — Wire voice input and output in macOS and mobile clients
- task-wire-voice-for-web-macos-mobile-clients (web, closed 2026-04-22T22:19:45.784Z) — Wire voice input and output in macOS and mobile clients
- task-wire-voice-for-web-macos-mobile-clients (cli, closed 2026-04-22T22:19:45.784Z) — Wire voice input and output in macOS and mobile clients

## Desired Outcome

The `voice` surface family is reviewed end-to-end and either confirmed coherent
or has follow-up tasks opened for each gap. Concretely, the review produces:

- a written verdict for each consolidation dimension below;
- rendered evidence (screenshots, screencasts, transcripts, or runtime probes) showing the
  surface family from an operator's perspective, not only per-surface unit logs;
- follow-up task ids for any duplicated rendering, missing contract conformance, stale
  legacy affordance, or unaddressed accepted critic warning surfaced during review.

## Constraints

- Do not silently "fix" a surface during this review. The output is a verdict and
  follow-up tasks; substantive changes belong in the follow-up tasks themselves.
- Per-surface unit test logs do not satisfy this review. The acceptance evidence must
  show the family from an operator's vantage point.
- Do not add a parallel cross-client docs catalog. Update scoped `AGENTS.md` near the
  surfaces being reviewed when conventions need adjustment.
- A consolidation task does not block future fan-out. Open follow-up tasks for gaps
  rather than freezing the queue.

## Done When

1. **Information architecture.** The `voice` capability is discoverable from
   each surface's primary navigation/menu without overloading other entries.
2. **Cross-client capability contract.** All client surfaces speak the same daemon contract
   (request shape, discriminated result arms, error codes, unavailable-state codes).
3. **Duplicated route/error/rendering logic.** Any duplicate decoder, error renderer, or
   provider-readiness probe across clients is named, with a follow-up task to fold it.
4. **Provider readiness and unavailable state.** Each surface degrades gracefully when the
   underlying provider is unavailable, surfacing the daemon's typed failure code.
5. **Live runtime/screenshot/transcript evidence.** A rendered artifact (screenshot,
   screencast, snapshot fixture, or runtime probe) per surface proves the surface family
   is coherent end-to-end, not only that per-surface tests pass.
6. **Stale legacy affordances.** Older surface affordances superseded by this fan-out are
   either removed or filed as removal tasks.
7. **Docs/AGENTS reality check.** Scoped `AGENTS.md` files near the reviewed surfaces
   describe what shipped; stale lines are pruned in the same change.
8. **Accepted critic warning review.** Any compatibility shim, baseline-only ratchet, or
   text-only visual proof previously accepted by a critic on these fan-out commits is
   either retired or has a follow-up task naming the retirement plan.

## Source / Intent

Auto-seeded by the fan-out-consolidator workflow after the `voice` capability
landed across 4 client surfaces between 2026-04-22T22:19:45.784Z
and 2026-04-22T22:19:45.784Z. The 2026-04-28 broad daemon review found that fan-out batches
without a holistic consolidation pass left an overloaded operator surface despite green
per-surface tests. This task is the autonomy queue's recurring corrective pass.

## Initiative

Autonomy quality control: fan-out should end in a coherent product surface, not just a
checklist of parity commits. Each capability gets one consolidation review per shipped
fan-out batch, and the review's output is operator-actionable follow-up tasks.

## Acceptance Evidence

- Rendered screenshots or screencasts (one per client surface) committed under a run
  directory or as snapshot fixtures, demonstrating the consolidated surface family.
- A transcript or runtime probe artifact showing each surface respects the same daemon
  contract (matching arms for the same request).
- A list of follow-up task ids opened for each consolidation finding, or a written note
  stating no follow-up was needed and why.
- Updated scoped `AGENTS.md` lines reflecting any convention adjustments arising from
  the review.

## Dropped Reason

Dropped during the 2026-05-07 corrective pass. This consolidation task came
from one broad voice task that named several clients in a single title, not
from a series of independently closed fan-out tasks. The corrected detector
assigns one primary surface per done task, so this shape no longer qualifies
for generated consolidation.

## Headless Review (completed)

Recorded under
`.kota/runs/2026-05-02T21-32-26-678Z-builder-ree4uo/voice-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/voice/routes.ts`
  shared handlers (covers both `/api/voice/*` and `/voice/*` transports).
- `cli-transcript.txt` — CLI transcript exercising
  `kota voice transcribe` / `kota voice speak` against a live daemon with
  no providers loaded (proves end-to-end propagation of the daemon-issued
  `stt-unavailable` / `tts-unavailable` codes through the CLI surface).
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions; no follow-up tasks were warranted, and the
  `src/modules/voice/AGENTS.md` update in this run captures the only
  convention adjustment surfaced (surface-local code policy).

What is left is the per-surface visual evidence the autonomous builder
cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/voice-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the three visual voice surfaces — web (`VoiceControls` in chat), mobile (`VoiceComposer` in `ChatDetailScreen`), and macOS (`ChatView` voice buttons). Operator runs each client against a daemon (with or without registered STT/TTS providers), captures one rendered artifact showing the mic+speaker controls and the failure-code banner state for an unavailable provider, and commits them under .kota/runs/voice-consolidation-screens-<stamp>/{web,mobile,macos}/. The daemon-side and CLI-side artifacts are already committed under .kota/runs/2026-05-02T21-32-26-678Z-builder-ree4uo/voice-consolidation/.
```
