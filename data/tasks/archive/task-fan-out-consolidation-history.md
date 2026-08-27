---
status: done
---

# Consolidate history surfaces across clients

## Problem

The `history` capability shipped across 5 client surfaces
(cli, daemon, macos, mobile, telegram) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `history`

Surfaces shipped:

- cli
- daemon
- macos
- mobile
- telegram

Recently closed fan-out tasks in this batch:

- task-add-daemon-http-apihistorysearch-semantic-search-r (daemon, closed 2026-04-27T03:11:47.189Z) — Add daemon HTTP /api/history/search semantic search route consuming HistoryProvider.semanticSearch
- task-add-kota-history-search-cli-semantic-search-subcom (cli, closed 2026-04-27T03:23:35.062Z) — Add kota history search CLI semantic search subcommand consuming /api/history/search
- task-add-telegram-history-command-exposing-on-demand-se (telegram, closed 2026-04-27T03:32:03.943Z) — Add Telegram /history command exposing on-demand semantic conversation search
- task-add-macos-menu-bar-historyview-consuming-daemoncli (macos, closed 2026-04-27T04:18:18.854Z) — Add macOS menu-bar HistoryView consuming DaemonClient.searchHistory
- task-add-mobile-historyscreen-consuming-searchhistory (mobile, closed 2026-04-27T04:56:04.668Z) — Add mobile HistoryScreen consuming searchHistory

## Desired Outcome

The `history` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `history` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `history` capability
landed across 5 client surfaces between 2026-04-27T03:11:47.189Z
and 2026-04-27T04:56:04.668Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-06-18T13-22-56-683Z-builder-7v9610/history-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/history/routes.ts`
  `handleSearchHistory` exercising the six envelope arms every client
  decodes through the shared seam: `semantic-true-unsupported` (200
  with `{ ok: false, reason: "semantic_unavailable" }` against a
  provider that returns `supportsSemanticSearch()=false`, the default
  in-process `ConversationHistory`), `semantic-true-supported` (200
  with `{ ok: true, conversations: [...] }` carrying the eight-field
  `ConversationRecord` projection with optional `source`),
  `semantic-true-empty` (200 with `{ ok: true, conversations: [] }`),
  `semantic-true-filter-forwarding` (asserts `cwd` and `source=user`
  reach `provider.semanticSearch` as `{ cwd, source }` per
  `routes.ts:91-93`), `keyword-fallback` (`semantic=false` routes
  through `provider.list({ search, limit, cwd, source })` and returns
  the same envelope), and `provider-throws` (500 typed
  `{ error: <message> }`).
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — `kota --help` discoverability (proves
  `history` is in the top-level command inventory), full
  `kota history --help` / `kota history list --help` /
  `kota history search --help` / `kota history show --help` surfaces,
  plus live `list -n 1` /
  `search ''` (typed usage hint, exit 1) / `search 'harness'` (typed
  `Semantic conversation search requires an embedding-backed history
  provider.`, exit 1) / `search 'harness' --json` (`{"ok":false,
  "reason":"semantic_unavailable"}`, exit 0) / `search 'harness'
  --keyword` (`No matching conversations.`) / `search 'harness'
  --keyword --json` (`{"ok":true,"conversations":[]}`) /
  `show missing-id`
  (`Conversation "missing-id" not found.`, exit 1) /
  `search 'q' --limit not-a-number` (typed input validation, exit 1)
  runs against an isolated `KOTA_SCOPE_ROOT` empty store. Confirms
  the CLI surface decodes the same `{ ok: true, conversations }` /
  `{ ok: false, reason: "semantic_unavailable" }` envelopes the
  visual clients mirror.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.
- `surfaces/mobile/history-screen-rendered.json` — React Native
  rendered-tree fixture generated by
  `clients/mobile/src/__tests__/HistoryScreen.test.tsx`, covering
  settings loading, no daemon configured, empty-query hint, loading
  RefreshControl, populated results, empty results, semantic-unavailable
  banner, HTTP error retry, offline banner, and cleared-on-reset state.
- `surfaces/macos/history-view-rendered-states.txt` — manifest for
  SwiftUI-rendered PNG snapshots generated by `HistoryViewTests` from mounted
  `HistoryBodyView` instances, covering the empty-query, loading, populated,
  empty-results, semantic-unavailable, error retry, and
  after-query-before-submit states. The PNGs live under
  `surfaces/macos/history-view-rendered-states/`.
- `surfaces/telegram/messages.md` — rendered Telegram `/history` reply
  fixture covering usage, populated, empty-result, and
  semantic-unavailable responses.

Follow-ups filed (or named) in this change:

- `data/tasks/archive/task-tighten-macos-conversationrecordsource-to-closed-u.md`
  (`area: client`, `priority: p3`) — Tighten the
  macOS `ConversationRecord.source` decoder in `HistoryModels.swift`
  from the permissive `let source: String?` to a closed
  `"user" | "action"` set, and add a
  `historySearch.negative_unknownSource` arm to
  `clients/conformance/contract-fixture.json` so the cross-client
  conformance gate catches the drift. Mobile and conformance both
  reject unknown source values today; macOS silently accepts them.
- `data/tasks/archive/task-share-or-conformance-test-daemon-wire-contracts-ac.md`
  (`priority: p1`, `area: architecture`) — named for traceability
  because the mobile `historyRender.ts` and `parseConversationRecord`
  cross-package mirrors are the same shape that umbrella covers.

The history module's `src/modules/history/AGENTS.md` "Operator
pull-surfaces" line is updated in this change to enumerate the
mobile `HistoryScreen` alongside Telegram `/history`, terminal
`kota history search`, and the macOS menu bar `HistoryView`. The
mobile surface shipped during this fan-out batch (`6fe77680`,
2026-04-27) and was missing from the inventory.

The macOS `HistoryView` fan-out commit `af334e4d` accepted
`pass_with_warnings` because the agent substituted a markdown
description for screenshots; the current `HistoryViewTests` PNG
snapshots and generated `history-view-rendered-states.txt` manifest
retire that text-only proof. The acceptance path for daemon, CLI,
Telegram, mobile, and macOS evidence is the current run directory
above.
