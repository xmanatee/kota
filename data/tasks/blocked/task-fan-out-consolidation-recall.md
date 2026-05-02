---
id: task-fan-out-consolidation-recall
title: Consolidate recall surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the recall surface family across telegram, macos, mobile, daemon for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-02T22:29:15.356Z
---

## Problem

The `recall` capability shipped across 4 client surfaces
(daemon, macos, mobile, telegram) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `recall`

Surfaces shipped:

- daemon
- macos
- mobile
- telegram

Recently closed fan-out tasks in this batch:

- task-add-telegram-recall-command-exposing-the-unified-c (telegram, closed 2026-04-27T07:55:05.506Z) — Add Telegram /recall command exposing the unified cross-store recall seam
- task-add-macos-daemonclientrecall-with-discriminated-re (macos, closed 2026-04-27T08:55:07.157Z) — Add macOS DaemonClient.recall with discriminated RecallSearchResponse types and unit tests
- task-add-macos-daemonclientrecall-with-discriminated-re (mobile, closed 2026-04-27T08:55:07.157Z) — Add macOS DaemonClient.recall with discriminated RecallSearchResponse types and unit tests
- task-add-macos-daemonclientrecall-with-discriminated-re (daemon, closed 2026-04-27T08:55:07.157Z) — Add macOS DaemonClient.recall with discriminated RecallSearchResponse types and unit tests
- task-add-macos-menu-bar-recallview-consuming-daemonclie (macos, closed 2026-04-27T09:32:22.259Z) — Add macOS menu-bar RecallView consuming DaemonClient.recall
- task-add-mobile-recallscreen-consuming-a-new-daemonclie (macos, closed 2026-04-27T10:14:02.308Z) — Add mobile RecallScreen consuming a new DaemonClient.recall
- task-add-mobile-recallscreen-consuming-a-new-daemonclie (mobile, closed 2026-04-27T10:14:02.308Z) — Add mobile RecallScreen consuming a new DaemonClient.recall
- task-add-mobile-recallscreen-consuming-a-new-daemonclie (telegram, closed 2026-04-27T10:14:02.308Z) — Add mobile RecallScreen consuming a new DaemonClient.recall
- task-add-mobile-recallscreen-consuming-a-new-daemonclie (daemon, closed 2026-04-27T10:14:02.308Z) — Add mobile RecallScreen consuming a new DaemonClient.recall

## Desired Outcome

The `recall` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `recall` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `recall` capability
landed across 4 client surfaces between 2026-04-27T07:55:05.506Z
and 2026-04-27T10:14:02.308Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-05-02T22-17-31-479Z-builder-e794xy/recall-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/recall/routes.ts`
  `createRecallRouteHandler` covering five envelope arms every client
  decodes (empty-query 400, no-contributors `semantic_unavailable` 200,
  mixed-source success 200 carrying one positive arm per closed
  `RecallSource` discriminator including `answer`, filter-coercion 200,
  provider-throws 500). The success arm pins the daemon's full closed
  source set `knowledge | memory | history | tasks | answer`.
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — CLI transcript exercising `kota --help`
  discoverability, full `kota recall --help` surface, plus live
  `recall ''` empty-query hint, `recall 'harness boundary'` /
  `recall 'harness boundary' --json` against the project's real
  knowledge/tasks store, and the three input-validation arms
  (`--source unknown`, `--limit not-a-number`, `--min-score 5`)
  exiting with the typed error lines.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

Follow-ups filed (or named) in this change:

- `data/tasks/ready/task-update-macos-and-mobile-recall-empty-state-copy-to.md`
  (new in this run, p3 client) — Update the macOS `RecallView.swift`
  and mobile `RecallScreen.tsx` empty-state hints to enumerate the
  closed five-source contributor set so operator copy matches the
  daemon's actual contributor set.
- `task-extend-cross-client-conformance-and-thin-client-de`
  (already filed by the answer consolidation, `backlog/`,
  p1 architecture) — named here for traceability. The same load-
  bearing drift (daemon's `source: "answer"` recall arm rejected by
  the four-arm thin-client decoders on mobile, web, and macOS) blocks
  the recall surface family from being decode-clean end-to-end. No
  duplicate filed.

The single docs touch (replacing the stale "no fan-out to other
operator surfaces" boundary line with the durable rule in
`src/modules/recall/AGENTS.md`) is applied in this same change.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/recall-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the five visual recall surfaces — telegram (`/recall <query>` rendered messages: populated hits, no-contributors semantic-unavailable, no-match, and offline cases), slack (`/recall <query>` rendered against a workspace covering the same arms), mobile (`RecallScreen` covering populated hits, empty-query hint, no-match, semantic-unavailable banner, and offline banner), macOS (`RecallView` populated hit list with source badges, the empty-state hint, the orange-foregrounded semantic-unavailable caption, no-match line, and the offline state), and web (`RecallPanel` covering the same arms). Operator runs each client against a daemon (with and without registered contributors) and commits the rendered artifacts under .kota/runs/recall-consolidation-screens-<stamp>/{telegram,slack,mobile,macos,web}/. The daemon-side and CLI-side artifacts are already committed under .kota/runs/2026-05-02T22-17-31-479Z-builder-e794xy/recall-consolidation/.
```
