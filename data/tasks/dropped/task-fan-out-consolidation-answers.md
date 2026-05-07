---
id: task-fan-out-consolidation-answers
title: Consolidate answers surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the answers surface family across macos, mobile, telegram, daemon for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-02T23:28:00.791Z
---

## Problem

The `answers` capability shipped across 4 client surfaces
(daemon, macos, mobile, telegram) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `answers`

Surfaces shipped:

- daemon
- macos
- mobile
- telegram

Recently closed fan-out tasks in this batch:

- task-add-recall-plus-cited-answer-plus-answer-history-e (macos, closed 2026-04-28T02:46:48.783Z) — Add recall plus cited-answer plus answer-history end-to-end integration test
- task-add-recall-plus-cited-answer-plus-answer-history-e (mobile, closed 2026-04-28T02:46:48.783Z) — Add recall plus cited-answer plus answer-history end-to-end integration test
- task-add-recall-plus-cited-answer-plus-answer-history-e (telegram, closed 2026-04-28T02:46:48.783Z) — Add recall plus cited-answer plus answer-history end-to-end integration test
- task-add-recall-plus-cited-answer-plus-answer-history-e (daemon, closed 2026-04-28T02:46:48.783Z) — Add recall plus cited-answer plus answer-history end-to-end integration test

## Desired Outcome

The `answers` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `answers` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `answers` capability
landed across 4 client surfaces between 2026-04-28T02:46:48.783Z
and 2026-04-28T02:46:48.783Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-05-02T23-16-15-695Z-builder-c6bbto/answers-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/answer/routes.ts`
  `createAnswerHistoryRouteHandler` exercising the seven envelope arms
  every client decodes through the shared seam: `list-empty`,
  `list-populated-default-limit` (pins the four-field
  `AnswerHistoryEntry` projection with `result` discriminated on `ok`
  carrying `citationCount` on success and `reason` on failure),
  `list-with-limit-and-before-cursor` (pins the cursor pagination
  shape), `list-store-throws` (500 typed daemon-error path),
  `show-found` (pins the full `AnswerHistoryRecord` including the
  persisted `RecallHit[]` the synthesizer was shown), `show-not-found`
  (pins the `not_found` discriminated arm), and `show-store-throws`
  (500 typed daemon-error path).
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — `kota --help` discoverability (proves
  `answer` is in the top-level command inventory), full
  `kota answer --help` / `kota answer log --help` /
  `kota answer show --help` surfaces, plus live `log` / `log --json` /
  `log -n 5 --json` / `log -b nonexistent-id --json` /
  `log --limit not-a-number` / `show missing-id` /
  `show missing-id --json` / `ask ''` / `ask 'harness' --limit 0` /
  `ask 'harness' --source unknown` runs against an isolated
  `KOTA_PROJECT_DIR` empty store. Confirms the CLI surface decodes
  the same `{ entries: [] }`, `{ ok: false, reason: "not_found" }`,
  and typed input-validation envelopes the visual clients mirror.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

Follow-ups filed (or named) in this change:

- `data/tasks/backlog/task-add-macos-daemonclientanswerloganswershow-and-answ.md`
  (new in this run, `area: client`, `priority: p3`) — Add the
  macOS `DaemonClient.answerLog`/`answerShow` methods and the
  paired `AnswerHistoryView` consuming the persisted
  answer-history routes. The Swift type mirrors are present and
  decode strictly, but no `DaemonClient` route function or UI view
  reaches them today, so the macOS operator cannot list or
  re-read past cited answers from the menu bar.
- `task-extend-cross-client-conformance-and-thin-client-de`
  (already filed by the prior `answer` consolidation, `backlog/`,
  p1 architecture) — named here for traceability. Relevant because
  a persisted `AnswerHistoryRecord`'s `recallHits[]` carries
  `source: "answer"` once the answer recall contributor surfaces a
  prior cited answer; the load-bearing decoder gap that task
  closes is the same shape that would block decode here.

The answer module's `src/modules/answer/AGENTS.md` already
accurately describes the shipped read surfaces (the prior
`answer` consolidation in commit `e1144d13` updated the boundary
line), so no docs touch is warranted in this consolidation.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/answers-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the live answer-history visual surfaces — telegram (`/answer-log` rendered against an empty store, `/answer-log` rendered against a populated store, `/answer-log 3` paged listing, `/answer-show <id>` for a known id with citations, `/answer-show <missing>` showing the typed not_found copy, `/answer-show <id>` for a long body chunked on blank lines, and the `Usage: /answer-log [N]` / `Usage: /answer-show <id>` hints), slack (the same `/answer-log` / `/answer-show` slash commands rendered against a workspace covering the same arms), mobile (`AnswerHistoryScreen` covering loading, populated list with mixed success/failure entries, populated detail with citations, empty-list label, `not_found` show banner, error retry, offline banner, and `Load more` pagination), and web (`AnswerHistoryPanel` covering loading, populated list, populated detail, empty-list label, `not_found` banner, error toast, and pagination). macOS is intentionally excluded from this precondition because no UI consumes the answer-history routes today; the follow-up task `task-add-macos-daemonclientanswerloganswershow-and-answ` covers the missing macOS surface and ships its own operator-capture artifact when it lands. Operator runs each client against a daemon (with both an empty and a populated answer-history store) and commits the rendered artifacts under .kota/runs/answers-consolidation-screens-<stamp>/{telegram,slack,mobile,web}/. The daemon-side and CLI-side artifacts are already committed under .kota/runs/2026-05-02T23-16-15-695Z-builder-c6bbto/answers-consolidation/.
```
