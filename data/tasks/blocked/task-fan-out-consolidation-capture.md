---
id: task-fan-out-consolidation-capture
title: Consolidate capture surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the capture surface family across macos, mobile, telegram, web, daemon, slack for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-03T00:16:29.830Z
---

## Problem

The `capture` capability shipped across 6 client surfaces
(daemon, macos, mobile, slack, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `capture`

Surfaces shipped:

- daemon
- macos
- mobile
- slack
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-telegram-capture-command-consuming-the-cross-s (macos, closed 2026-04-28T03:59:14.491Z) — Add Telegram /capture command consuming the cross-store capture seam
- task-add-telegram-capture-command-consuming-the-cross-s (mobile, closed 2026-04-28T03:59:14.491Z) — Add Telegram /capture command consuming the cross-store capture seam
- task-add-telegram-capture-command-consuming-the-cross-s (telegram, closed 2026-04-28T03:59:14.491Z) — Add Telegram /capture command consuming the cross-store capture seam
- task-add-web-capturepanel-consuming-the-cross-store-cap (macos, closed 2026-04-28T04:27:26.705Z) — Add web CapturePanel consuming the cross-store capture seam
- task-add-web-capturepanel-consuming-the-cross-store-cap (mobile, closed 2026-04-28T04:27:26.705Z) — Add web CapturePanel consuming the cross-store capture seam
- task-add-web-capturepanel-consuming-the-cross-store-cap (web, closed 2026-04-28T04:27:26.705Z) — Add web CapturePanel consuming the cross-store capture seam
- task-add-web-capturepanel-consuming-the-cross-store-cap (telegram, closed 2026-04-28T04:27:26.705Z) — Add web CapturePanel consuming the cross-store capture seam
- task-add-macos-daemonclientcapture-with-discriminated-c (macos, closed 2026-04-28T04:57:41.294Z) — Add macOS DaemonClient.capture with discriminated CaptureResult types and unit tests
- task-add-macos-daemonclientcapture-with-discriminated-c (mobile, closed 2026-04-28T04:57:41.294Z) — Add macOS DaemonClient.capture with discriminated CaptureResult types and unit tests
- task-add-macos-daemonclientcapture-with-discriminated-c (daemon, closed 2026-04-28T04:57:41.294Z) — Add macOS DaemonClient.capture with discriminated CaptureResult types and unit tests
- task-add-mobile-capturescreen-consuming-a-new-daemoncli (macos, closed 2026-04-28T05:44:43.151Z) — Add mobile CaptureScreen consuming a new DaemonClient.capture
- task-add-mobile-capturescreen-consuming-a-new-daemoncli (mobile, closed 2026-04-28T05:44:43.151Z) — Add mobile CaptureScreen consuming a new DaemonClient.capture
- task-add-mobile-capturescreen-consuming-a-new-daemoncli (telegram, closed 2026-04-28T05:44:43.151Z) — Add mobile CaptureScreen consuming a new DaemonClient.capture
- task-add-mobile-capturescreen-consuming-a-new-daemoncli (daemon, closed 2026-04-28T05:44:43.151Z) — Add mobile CaptureScreen consuming a new DaemonClient.capture
- task-add-slack-channel-recall-answer-and-capture-comman (telegram, closed 2026-04-28T05:55:55.091Z) — Add Slack-channel /recall, /answer, and /capture commands consuming the cross-store seams
- task-add-slack-channel-recall-answer-and-capture-comman (slack, closed 2026-04-28T05:55:55.091Z) — Add Slack-channel /recall, /answer, and /capture commands consuming the cross-store seams
- task-add-macos-menu-bar-captureview-consuming-daemoncli (macos, closed 2026-04-28T06:03:47.017Z) — Add macOS menu-bar CaptureView consuming DaemonClient.capture
- task-add-capture-pipeline-integration-test-boots-daemon (macos, closed 2026-04-28T06:19:38.996Z) — Add capture pipeline integration test boots daemon over seeded contributors covers POST /capture and POST /api/capture for every CaptureRecord arm classifier ambiguous fallback and contributor failure
- task-add-capture-pipeline-integration-test-boots-daemon (mobile, closed 2026-04-28T06:19:38.996Z) — Add capture pipeline integration test boots daemon over seeded contributors covers POST /capture and POST /api/capture for every CaptureRecord arm classifier ambiguous fallback and contributor failure
- task-add-capture-pipeline-integration-test-boots-daemon (telegram, closed 2026-04-28T06:19:38.996Z) — Add capture pipeline integration test boots daemon over seeded contributors covers POST /capture and POST /api/capture for every CaptureRecord arm classifier ambiguous fallback and contributor failure
- task-add-capture-pipeline-integration-test-boots-daemon (slack, closed 2026-04-28T06:19:38.996Z) — Add capture pipeline integration test boots daemon over seeded contributors covers POST /capture and POST /api/capture for every CaptureRecord arm classifier ambiguous fallback and contributor failure
- task-add-capture-pipeline-integration-test-boots-daemon (daemon, closed 2026-04-28T06:19:38.996Z) — Add capture pipeline integration test boots daemon over seeded contributors covers POST /capture and POST /api/capture for every CaptureRecord arm classifier ambiguous fallback and contributor failure

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
landed across 6 client surfaces between 2026-04-28T03:59:14.491Z
and 2026-04-28T06:19:38.996Z. The 2026-04-28 broad daemon review found that fan-out batches
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

## Headless Review (completed)

Recorded under
`.kota/runs/2026-05-03T00-02-07-769Z-builder-pr27t6/capture-consolidation/`:

- `contract-probe.json` — 13-arm runtime probe of
  `createCaptureRouteHandler` (the shared backend for both
  `POST /capture` daemon-control and `POST /api/capture` user-facing).
  Arms: `empty-text-rejected`, `malformed-body-rejected`,
  `success-explicit-target`, `success-tasks-with-path` (pinning the
  `path` field every filesystem-target client decoder requires),
  `ambiguous-no-classifier` (suggestions ordered by
  `CAPTURE_TARGET_ORDER` = memory, knowledge, tasks, inbox — the
  order every chat command list and visual picker mirrors),
  `ambiguous-classifier-throws` (custom classifier that does NOT
  wrap its throws surfaces 500 — pins the doc-vs-code split between
  the production `createDefaultClassifier` wrapper and the underlying
  `CaptureProviderImpl`), `ambiguous-classifier-says-ambiguous`,
  `unregistered-explicit-target`, `no-contributors-zero`,
  `contributor-throws`, `classifier-confident-pick`,
  `classifier-receives-trimmed-text-and-hint` (asserts the seam
  trims whitespace before classifying and forwards the operator's
  `hint` verbatim), and `provider-throws-unhandled`.
- `probe-contract.mjs` — the probe source kept alongside its
  artifact.
- `cli-transcript.txt` — `pnpm kota --help` discoverability (proves
  `capture` is in the top-level command inventory),
  `pnpm kota capture --help` flag inventory, and live runs covering
  no-args / whitespace-only / bogus-target validation, explicit
  target dispatch into memory / knowledge / inbox (with side-effects
  cleaned up after capture), `--json` envelope output, and the
  classifier-driven path against the live KOTA project store with
  no model-client config (the production wrapper degrades to the
  typed `ambiguous` arm rather than throwing). The CLI surface is
  fully covered by this transcript; CLI is not subject to the
  unblock precondition below.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

Follow-ups filed (or named) in this change:

- `data/tasks/backlog/task-fold-conformance-decoders-into-web-client-runtime-.md`
  (new in this run, `area: client`, `priority: p3`) — the web
  client's production `api.capture` / `api.retract` / `api.recall`
  / `api.answer` / per-store `api.*.search` paths use
  `apiJson<T>` (a TypeScript type assertion) rather than running the
  conformance `parseCaptureResult` / `parse*` decoders the
  `clients/web/src/api/contractFixture.test.ts` already exercises.
  Mobile and macOS already strict-decode in production. The
  follow-up folds the conformance decoders into the web runtime so
  unknown discriminators throw at the web boundary instead of
  silently flowing into the UI as typed-but-invalid objects.

The `src/modules/capture/AGENTS.md` "Boundaries" line is updated in
this change to enumerate the live cross-store capture seam consumers
(daemon `POST /capture` + `POST /api/capture`, `kota capture <text>`,
macOS `CaptureView` via `DaemonClient.capture`, mobile `CaptureScreen`,
web sidebar `CapturePanel`, Telegram `/capture` + four `/capture-to-*`,
Slack-channel `/capture` + four `/capture-to-*`) instead of the stale
2026-04-28 "fan-out lands later" line. The "Degradation rules"
classifier-throws line is rewritten to clarify the wrapper layer
(`createDefaultClassifier`) catches its own model-client throws and
returns `{ kind: "ambiguous" }`, while the underlying
`CaptureProviderImpl.capture` does not — a custom CaptureClassifier
that does NOT wrap its throws will surface as 500 at the route
boundary.

The `805a6edf` (seam) / `d4c35d1e` (Telegram) / `d9d34b89` (web) /
`33595c0a` + `65aed37e` (macOS) / `23f9c52e` (mobile) / `fe68c952`
(Slack) closing fan-out commits were spot-checked for accepted critic
warnings; none rely on a markdown-description-instead-of-screenshots
substitution that needs a named retirement plan. The macOS and mobile
task `## Acceptance Evidence` lines accepted "transcript or screenshot"
with the explicit `or`, so the visual-evidence gap is captured by the
operator-capture precondition below rather than as a separate
retirement plan.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/capture-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the live capture visual surfaces — telegram (`/capture <text>` against an embedding-backed model client returning a successful classifier pick + the corresponding `Captured to <store>: <recordId>` chat reply, `/capture <text>` against an unconfigured-or-throwing classifier returning the typed `Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.` ambiguous chat reply, `/capture-to-tasks <text>` returning the typed `Captured to tasks: <id> (<path>)` reply with the filesystem path, and a `/capture` against zero registered contributors rendering `Cross-store capture has no registered contributors.`), mobile (`CaptureScreen` covering: the empty-state `Type a note and tap Capture to route it across memory, knowledge, tasks, or inbox.` usage hint, the loading state via the RefreshControl, all four success-record badge tints (memory purple, knowledge blue, tasks orange, inbox green) with the `Captured: <target>  <recordId>[  <path>]` body shape from the shared `renderCaptureResultPlain` helper, the orange ambiguous body with the four suggestion chips, the red contributor-failed body, the orange `Cross-store capture has no registered contributors.` body, the daemon-offline banner, and the textInput error retry path), and macOS (`CaptureView` covering: the `Type a note. Pick a store or leave on auto, then submit.` empty-draft caption, the `Press Capture to route this note.` after-typing-but-before-submit caption, the `Capturing…` spinner caption mid-loading, all four `CaptureSuccessRow` arms with the per-target badge and `Captured: <target>  <recordId>[  <path>]` mono body, the orange `CaptureAmbiguousRow` with the four `CaptureStateBadge` chips and `Pick a store from the picker above and resubmit.` footnote, the orange `CaptureNoticeRow` for `no_contributors`, and the red `CaptureFailedRow` with the per-target badge plus retry button), and web (`CapturePanel` covering: empty textarea, the `auto + memory + knowledge + tasks + inbox` Select option list, all four success-record arms with the per-target Badge variant and `recordId`+`path` rendering, the `Capture target is ambiguous — pick a store:` banner with the four interactive suggestion `Button` arms that re-issue with `--target`, the destructive `Capture unavailable — no contributors registered.` banner, and the per-target Badge + destructive-message contributor-failed row). CLI is excluded because the headless transcript at `.kota/runs/2026-05-03T00-02-07-769Z-builder-pr27t6/capture-consolidation/cli-transcript.txt` already covers every CLI arm. Daemon is excluded because the runtime probe at `.kota/runs/2026-05-03T00-02-07-769Z-builder-pr27t6/capture-consolidation/contract-probe.json` covers every wire envelope across both `/capture` and `/api/capture`. Slack-channel is opportunistic, not required: the rendered chat replies flow through the same `renderCaptureReplyPlain` helper Telegram uses, so the Telegram captures cover the chat-rendered shape both surfaces share. Operator runs each visual client against a daemon configured (a) with a populated registry covering all four contributors plus an embedding/model-client-backed classifier so the classifier-confident-pick arm renders, and (b) at least once against an unconfigured classifier (no `.kota/config.json` model entry) so the typed `ambiguous` arm renders, and commits the rendered artifacts under .kota/runs/capture-consolidation-screens-<stamp>/{telegram,mobile,macos,web}/.
```
