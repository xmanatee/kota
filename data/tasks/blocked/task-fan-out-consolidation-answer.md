---
id: task-fan-out-consolidation-answer
title: Consolidate answer surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the answer surface family across macos, mobile, slack, telegram, web for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-07T00:00:00.000Z
---

## Problem

The `answer` capability shipped across 5 client surfaces
(macos, mobile, slack, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `answer`

Surfaces shipped:

- macos
- mobile
- slack
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-telegram-answer-command-consuming-the-cited-an (telegram, closed 2026-04-27T11:23:15.264Z) — Add Telegram /answer command consuming the cited-answer seam
- task-add-web-answerpanel-consuming-the-cited-answer-sea (web, closed 2026-04-27T11:52:44.955Z) — Add web AnswerPanel consuming the cited-answer seam
- task-add-macos-daemonclientanswer-with-discriminated-an (macos, closed 2026-04-27T12:23:48.103Z) — Add macOS DaemonClient.answer with discriminated AnswerResult types and unit tests
- task-add-macos-menu-bar-answerview-consuming-daemonclie (macos, closed 2026-04-27T14:03:29.452Z) — Add macOS menu-bar AnswerView consuming DaemonClient.answer
- task-add-mobile-answerscreen-consuming-daemonclientansw (mobile, closed 2026-04-27T14:39:21.697Z) — Add mobile AnswerScreen consuming DaemonClient.answer
- task-add-telegram-answer-log-and-answer-show-commands-c (telegram, closed 2026-04-28T01:05:42.155Z) — Add Telegram /answer-log and /answer-show commands consuming the answer-history seam
- task-add-web-answerhistorypanel-consuming-the-answer-hi (web, closed 2026-04-28T02:05:23.137Z) — Add web AnswerHistoryPanel consuming the answer-history seam
- task-extend-slack-channel-slash-command-parity-to-answe (slack, closed 2026-04-28T06:54:11.990Z) — Extend Slack-channel slash-command parity to /answer-log and /answer-show closing the answer-history surface gap
- task-add-mobile-answerhistoryscreen-consuming-daemoncli (mobile, closed 2026-04-28T08:50:33.116Z) — Add mobile AnswerHistoryScreen consuming DaemonClient answer-log and answer-show
- task-add-macos-daemonclientanswerloganswershow-and-answ (macos, closed 2026-05-03T03:25:42.072Z) — Add macOS DaemonClient.answerLog/answerShow and AnswerHistoryView consuming the persisted answer-history routes

## Desired Outcome

The `answer` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `answer` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `answer` capability
landed across 5 client surfaces between 2026-04-27T11:23:15.264Z
and 2026-05-03T03:25:42.072Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-05-02T21-58-27-752Z-builder-etz2oj/answer-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/answer/routes.ts`
  `createAnswerRouteHandler` covering all six envelope arms every
  client decodes (empty-query 400, `ok: true` success with mixed
  `knowledge`/`answer` citations 200, `no_hits` 200,
  `semantic_unavailable` 200, `synthesis_failed` 200, provider-throws
  500). The success arm pins the daemon's full closed citation source
  set `knowledge | memory | history | tasks | answer`.
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — CLI transcript exercising
  `kota --help` discoverability, full `kota answer --help` /
  `ask --help` / `log --help` / `show --help` surface, plus live
  `log` / `log --json` / `show <missing-id>` /
  `show <missing-id> --json` / `ask ''` runs against an empty
  isolated tempdir store. Proves end-to-end propagation of the
  daemon-issued `not_found` arm and the seam's empty-query usage
  hint through the CLI surface.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions; one load-bearing follow-up task was filed and the
  single docs touch (replacing a stale boundary line in
  `src/modules/answer/AGENTS.md`) is applied in this same change.

Follow-up filed in this change:

- `data/tasks/backlog/task-extend-cross-client-conformance-and-thin-client-de.md`
  — Extend the cross-client conformance fixture and thin-client
  decoders so the daemon's `source: "answer"` `RecallHit` arm and
  `AnswerCitation` source decode on every visual surface
  (mobile, web, macOS).

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/answer-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the five visual answer surfaces — telegram (`/answer <query>`, `/answer-log`, `/answer-show <id>` rendered messages: populated, no-match, semantic-unavailable, synthesis-failed, not-found, and empty/usage-hint cases), slack (the same three slash commands rendered against a workspace), mobile (`AnswerScreen` and `AnswerHistoryScreen` covering populated, empty-query hint, no-match card, semantic-unavailable banner, synthesis-failed banner, and offline banner), macOS (`AskUnifiedView` with the Answer mode populated, the no-match line, the orange-foregrounded semantic-unavailable and synthesis-failed captions, and the answer-history list/show surfaces), and web (`AnswerPanel` and `AnswerHistoryPanel` covering the same arms). Operator runs each client against a daemon (with and without a configured model provider) and commits the rendered artifacts under .kota/runs/answer-consolidation-screens-<stamp>/{telegram,slack,mobile,macos,web}/. The daemon-side and CLI-side artifacts are already committed under .kota/runs/2026-05-02T21-58-27-752Z-builder-etz2oj/answer-consolidation/.
```
