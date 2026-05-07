---
id: task-fan-out-consolidation-attention
title: Consolidate attention surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the attention surface family across cli, daemon, macos, mobile, slack, telegram, web for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-07T00:00:00.000Z
---

## Problem

The `attention` capability shipped across 7 client surfaces
(cli, daemon, macos, mobile, slack, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `attention`

Surfaces shipped:

- cli
- daemon
- macos
- mobile
- slack
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-telegram-attention-command-exposing-on-demand- (telegram, closed 2026-04-26T06:56:23.671Z) — Add Telegram /attention command exposing on-demand attention digest
- task-add-kota-attention-cli-command-consuming-the-on-de (cli, closed 2026-04-26T07:28:07.048Z) — Add kota attention CLI command consuming the on-demand attention seam
- task-add-daemon-http-attention-endpoint-consuming-the-o (daemon, closed 2026-04-26T08:00:36.788Z) — Add daemon HTTP attention endpoint consuming the on-demand attention seam
- task-add-web-client-attention-panel-consuming-apiattent (web, closed 2026-04-26T08:34:11.041Z) — Add web client attention panel consuming /api/attention
- task-add-macos-menu-bar-attentionview-consuming-apiatte (macos, closed 2026-04-26T09:12:07.628Z) — Add macOS menu bar AttentionView consuming /api/attention
- task-add-mobile-attentionscreen-consuming-apiattention (mobile, closed 2026-04-26T09:23:41.770Z) — Add mobile AttentionScreen consuming /api/attention
- task-extend-slack-channel-slash-command-parity-to-memor (slack, closed 2026-04-28T06:35:11.657Z) — Extend Slack-channel slash-command parity to /memory /knowledge /history /tasks /attention and /digest matching the Telegram surface
- task-fold-conformance-decoders-into-mobile-digest-and-a (mobile, closed 2026-05-03T06:59:54.361Z) — Fold conformance decoders into mobile digest and attention runtime paths

## Desired Outcome

The `attention` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `attention` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `attention` capability
landed across 7 client surfaces between 2026-04-26T06:56:23.671Z
and 2026-05-03T06:59:54.361Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-05-02T22-48-37-067Z-builder-4jyxov/attention-consolidation/`:

- `contract-probe.json` — runtime probe of
  `src/modules/autonomy/workflows/attention-digest/attention-route.ts`
  `attentionRoutes` covering both documented envelope arms: quiet
  project (no detector triggers, fixed `NO_ATTENTION_ITEMS_TEXT`
  reply) and populated project (deterministic detector items —
  stale-blocker entries, empty-ready, empty-backlog labels). The
  route's defensive 500 fallback is documented but unexercisable in
  practice because the underlying detectors (`countRepoTaskState`,
  `listRepoTasksInState`, `loadRunsInWindow`) all swallow ENOENT.
- `probe-contract.mjs` — the probe source kept alongside its
  artifact.
- `cli-transcript.txt` — CLI transcript exercising `kota --help`
  (proves `attention` is in the top-level command inventory), full
  `kota attention --help`, plus live `kota attention` /
  `kota attention --json` runs against the real project tree which
  surface the live `Blocked backlog`, multiple `Stale blocker`, and
  `More long-blocked tasks` items. Both the rendered text and `--json`
  shapes match the seam contract byte-for-byte.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

No follow-up tasks were warranted: the surface family is coherent,
no fold-able decoder/error duplication exists, and the only
adjustments needed were two doc lines (the macOS `AttentionView.swift`
header doc-comment which still claimed five pull-surfaces was updated
to the current seven, and
`src/modules/autonomy/workflows/attention-digest/AGENTS.md` was
updated to add Slack to the on-demand seam consumer list and to pin
the no-provider-arm convention so future attention surface mirrors
do not mint a phantom `semantic_unavailable` arm). Both doc updates
land in this same change.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/attention-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the five visual attention surfaces — telegram (`/attention` rendered messages: quiet project NO_ATTENTION_ITEMS_TEXT reply and populated multi-item digest), slack (`/attention` rendered against a workspace covering the same two arms), mobile (`AttentionScreen` covering the quiet `nothing pending` badge, populated badge with item count, the offline banner, and the error-with-retry state), macOS (`AttentionView` covering the collapsed badge, the expanded body with monospace text, the orange-foregrounded item-count badge, the loading state, and the error/retry surface), and web (`AttentionPanel` in the embedded sidebar covering the success-with-items state, the success-with-zero-items "nothing pending" badge, the loading state, and the error-with-retry state). Operator runs each client against a daemon backed by a project that exhibits both arms (a quiet project and the live multi-blocked project), and commits the rendered artifacts under .kota/runs/attention-consolidation-screens-<stamp>/{telegram,slack,mobile,macos,web}/. The daemon-side and CLI-side artifacts are already committed under .kota/runs/2026-05-02T22-48-37-067Z-builder-4jyxov/attention-consolidation/.
```
