---
id: task-fan-out-consolidation-retract
title: Consolidate retract surfaces across clients
status: ready
priority: p2
area: client
summary: Review the retract surface family across telegram, macos, mobile, web, daemon, cli, slack for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-02T21:31:53.684Z
---

## Problem

The `retract` capability shipped across 7 client surfaces
(cli, daemon, macos, mobile, slack, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `retract`

Surfaces shipped:

- cli
- daemon
- macos
- mobile
- slack
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-telegram-retract-command-consuming-the-cross-s (telegram, closed 2026-04-28T11:11:36.190Z) — Add Telegram /retract command consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (macos, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (mobile, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (web, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (telegram, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-macos-daemonclientretract-with-discriminated-r (macos, closed 2026-04-28T12:10:57.748Z) — Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
- task-add-macos-daemonclientretract-with-discriminated-r (mobile, closed 2026-04-28T12:10:57.748Z) — Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
- task-add-macos-daemonclientretract-with-discriminated-r (daemon, closed 2026-04-28T12:10:57.748Z) — Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
- task-add-macos-menu-bar-retractview-consuming-daemoncli (macos, closed 2026-04-28T13:11:10.301Z) — Add macOS menu-bar RetractView consuming DaemonClient.retract
- task-add-macos-menu-bar-retractview-consuming-daemoncli (mobile, closed 2026-04-28T13:11:10.301Z) — Add macOS menu-bar RetractView consuming DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (macos, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (mobile, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (telegram, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (cli, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-extend-slack-channel-slash-command-parity-to-retra (telegram, closed 2026-04-28T14:19:31.354Z) — Extend Slack-channel slash-command parity to /retract-<store> closing the chat-channel parity gap
- task-extend-slack-channel-slash-command-parity-to-retra (slack, closed 2026-04-28T14:19:31.354Z) — Extend Slack-channel slash-command parity to /retract-<store> closing the chat-channel parity gap

## Desired Outcome

The `retract` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `retract` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `retract` capability
landed across 7 client surfaces between 2026-04-28T11:11:36.190Z
and 2026-04-28T14:19:31.354Z. The 2026-04-28 broad daemon review found that fan-out batches
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
