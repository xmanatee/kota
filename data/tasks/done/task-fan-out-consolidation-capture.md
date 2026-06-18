---
id: task-fan-out-consolidation-capture
title: Consolidate capture surfaces across clients
status: done
priority: p2
area: client
summary: Review the capture surface family across macos, mobile, slack, telegram, web for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-06-18T15:54:09.099Z
---

## Problem

The `capture` capability shipped across 5 client surfaces
(macos, mobile, slack, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `capture`

Surfaces shipped:

- macos
- mobile
- slack
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-telegram-capture-command-consuming-the-cross-s (telegram, closed 2026-04-28T03:59:14.491Z) — Add Telegram /capture command consuming the cross-store capture seam
- task-add-web-capturepanel-consuming-the-cross-store-cap (web, closed 2026-04-28T04:27:26.705Z) — Add web CapturePanel consuming the cross-store capture seam
- task-add-macos-daemonclientcapture-with-discriminated-c (macos, closed 2026-04-28T04:57:41.294Z) — Add macOS DaemonClient.capture with discriminated CaptureResult types and unit tests
- task-add-mobile-capturescreen-consuming-a-new-daemoncli (mobile, closed 2026-04-28T05:44:43.151Z) — Add mobile CaptureScreen consuming a new DaemonClient.capture
- task-add-slack-channel-recall-answer-and-capture-comman (slack, closed 2026-04-28T05:55:55.091Z) — Add Slack-channel /recall, /answer, and /capture commands consuming the cross-store seams
- task-add-macos-menu-bar-captureview-consuming-daemoncli (macos, closed 2026-04-28T06:03:47.017Z) — Add macOS menu-bar CaptureView consuming DaemonClient.capture

## Desired Outcome

The `capture` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `capture` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `capture` capability
landed across 5 client surfaces between 2026-04-28T03:59:14.491Z
and 2026-04-28T06:03:47.017Z. The 2026-04-28 broad daemon review found that fan-out batches
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

## Headless Review (reverified 2026-06-18)

Final review artifacts are recorded under
`.kota/runs/2026-06-18T15-45-57-334Z-builder-stgh68/`.

Current contract and operator evidence:

- `capture-consolidation/contract-probe.json` — passing 13-arm probe of
  `createCaptureRouteHandler`, the shared backend for daemon `POST /capture`
  and web-facing `POST /api/capture`.
- `capture-consolidation/cli-transcript.txt` — `kota --help`,
  `kota capture --help`, no-args, whitespace-only, and bogus-target validation
  transcript from the built CLI with no store side effects.
- `capture-consolidation/surface-runtime-evidence/web/` — mounted
  `CapturePanel` DOM for empty, all four success targets, ambiguous,
  no-contributors, contributor-failed, and strict decode-error states.
- `capture-consolidation/surface-runtime-evidence/mobile/` — mounted React
  Native `CaptureScreen` trees for empty, loading, all four success targets,
  ambiguous, no-contributors, contributor-failed, HTTP error + retry, offline,
  and no-daemon states.
- `capture-consolidation/surface-runtime-evidence/macos/` — SwiftUI
  `ImageRenderer` PNGs for `CaptureExpandedContent` / `CaptureBodyView`
  covering empty, ready-before-submit, loading, all four success targets,
  ambiguous, no-contributors, contributor-failed, and HTTP error + retry.
- `capture-consolidation/surface-runtime-evidence/telegram/` — rendered
  `sendMessage` payloads from the real Telegram `/capture` command handler
  and `renderCaptureReplyPlain`.
- `capture-consolidation/surface-runtime-evidence/slack/` — rendered
  `chat.postMessage` payloads from the Slack slash-command dispatcher and
  `renderCaptureReplyPlain`.
- `capture-consolidation/surface-runtime-probe.json` — passing verifier that
  all five shipped surfaces have the expected artifacts and arms.
- `capture-consolidation/verdict.md` — final written verdict for the eight
  Done-When dimensions.

## Superseded Operator-Capture Note

The previous operator-capture blocker is no longer active. It is closed by the
current run's `capture-consolidation/surface-runtime-evidence/` artifacts and
passing `capture-consolidation/surface-runtime-probe.json`.

## Superseded Promotion Evidence

The 2026-06-15 promotion artifact under
`.kota/runs/capture-consolidation-screens-20260615T160041Z/` was not used as
final completion evidence because it did not contain a complete per-surface
artifact set. The current run's `capture-consolidation/surface-runtime-evidence/`
directory supersedes it with explicit web, mobile, macOS, Telegram, and Slack
artifacts.

## Completion Review (2026-06-18)

Final review artifacts are recorded under
`.kota/runs/2026-06-18T15-45-57-334Z-builder-stgh68/`.

The capture consolidation can close:

- `capture-module-tests.txt` — 53 passing capture module tests across the
  provider, route handler, CLI, daemon-client, agent tool, and dynamic prompt
  gate.
- `web-capture-tests.txt` — 86 passing web tests covering the conformance
  fixture, decoder-boundary behavior, and `CapturePanel`.
- `mobile-capture-tests.txt` — 83 passing mobile tests covering
  `CaptureScreen` and the contract fixture.
- `apple-capture-tests.txt` — 74 passing Swift tests covering
  `CaptureViewTests` and `ContractFixtureTests` (`swift test --disable-sandbox`
  was needed because SwiftPM's nested sandbox is blocked inside this run
  sandbox).
- `capture-consolidation-completion-review.md` — final Done-When review.

The one follow-up named by the earlier consolidation review,
`task-fold-conformance-decoders-into-web-client-runtime-`, is now done. Current
web runtime code calls `apiDecoded("/api/capture", parseCaptureResult, ...)`,
so the previous web decoder drift has been retired. No new follow-up task is
needed.
