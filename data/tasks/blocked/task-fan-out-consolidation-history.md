---
id: task-fan-out-consolidation-history
title: Consolidate history surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the history surface family across daemon, telegram, macos, mobile, cli for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-02T23:43:14.397Z
---

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
- task-add-telegram-history-command-exposing-on-demand-se (telegram, closed 2026-04-27T03:32:03.943Z) — Add Telegram /history command exposing on-demand semantic conversation search
- task-add-telegram-history-command-exposing-on-demand-se (daemon, closed 2026-04-27T03:32:03.943Z) — Add Telegram /history command exposing on-demand semantic conversation search
- task-add-macos-daemonclientsearchhistory-with-discrimin (macos, closed 2026-04-27T03:42:34.602Z) — Add macOS DaemonClient.searchHistory with discriminated HistorySearchResponse types and unit tests
- task-add-macos-daemonclientsearchhistory-with-discrimin (daemon, closed 2026-04-27T03:42:34.602Z) — Add macOS DaemonClient.searchHistory with discriminated HistorySearchResponse types and unit tests
- task-add-macos-menu-bar-historyview-consuming-daemoncli (macos, closed 2026-04-27T04:18:18.854Z) — Add macOS menu-bar HistoryView consuming DaemonClient.searchHistory
- task-add-macos-menu-bar-historyview-consuming-daemoncli (daemon, closed 2026-04-27T04:18:18.854Z) — Add macOS menu-bar HistoryView consuming DaemonClient.searchHistory
- task-add-mobile-historyscreen-consuming-searchhistory (macos, closed 2026-04-27T04:56:04.668Z) — Add mobile HistoryScreen consuming searchHistory
- task-add-mobile-historyscreen-consuming-searchhistory (mobile, closed 2026-04-27T04:56:04.668Z) — Add mobile HistoryScreen consuming searchHistory
- task-add-mobile-historyscreen-consuming-searchhistory (telegram, closed 2026-04-27T04:56:04.668Z) — Add mobile HistoryScreen consuming searchHistory
- task-add-mobile-historyscreen-consuming-searchhistory (cli, closed 2026-04-27T04:56:04.668Z) — Add mobile HistoryScreen consuming searchHistory
- task-add-mobile-historyscreen-consuming-searchhistory (daemon, closed 2026-04-27T04:56:04.668Z) — Add mobile HistoryScreen consuming searchHistory

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
`.kota/runs/2026-05-02T23-31-34-840Z-builder-2o6c4j/history-consolidation/`:

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
  plus live `list` / `list -n 5` / `list -s no-such-substring` /
  `search ''` (typed usage hint, exit 1) / `search 'harness'` (typed
  `Semantic conversation search requires an embedding-backed history
  provider.`, exit 1) / `search 'harness' --json` (`{"ok":false,
  "reason":"semantic_unavailable"}`, exit 0) / `search 'harness'
  --keyword` (`No matching conversations.`) / `search 'harness'
  --keyword --json` (`{"ok":true,"conversations":[]}`) / `search
  'harness' --no-semantic` (alias for `--keyword`) / `show missing-id`
  (`Conversation "missing-id" not found.`, exit 1) / `reindex`
  (no-provider skip line) / `clear --yes` (empty store path) /
  `search 'q' --limit not-a-number` (typed input validation, exit 1)
  runs against an isolated `KOTA_PROJECT_DIR` empty store. Confirms
  the CLI surface decodes the same `{ ok: true, conversations }` /
  `{ ok: false, reason: "semantic_unavailable" }` envelopes the
  visual clients mirror.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

Follow-ups filed (or named) in this change:

- `data/tasks/backlog/task-tighten-macos-conversationrecordsource-to-closed-u.md`
  (new in this run, `area: client`, `priority: p3`) — Tighten the
  macOS `ConversationRecord.source` decoder in `HistoryModels.swift`
  from the permissive `let source: String?` to a closed
  `"user" | "action"` set, and add a
  `historySearch.negative_unknownSource` arm to
  `clients/conformance/contract-fixture.json` so the cross-client
  conformance gate catches the drift. Mobile and conformance both
  reject unknown source values today; macOS silently accepts them.
- `task-share-or-conformance-test-daemon-wire-contracts-ac`
  (already filed, `doing/`, p1 architecture) — named for traceability
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
description for screenshots; the operator-capture precondition
below is the explicit retirement plan.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/history-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the live history-search visual surfaces — telegram (`/history` against an empty store rendering `No matching conversations.`, `/history` against an embedding-backed populated store rendering the shared `id  YYYY-MM-DD HH:MM    N msgs  title` line shape, `/history` against the default in-process provider rendering the typed `Semantic conversation search requires an embedding-backed history provider.` body, and the `Usage: /history <query>` hint for empty/whitespace input), mobile (`HistoryScreen` covering loading via the RefreshControl, populated list with the shared line shape, empty list with the `No matching conversations.` label, the typed `semantic_unavailable` banner, error retry, offline banner, the `Type a query and tap Search to query history.` empty-query hint, and the cleared-on-reset state), and macOS (`HistoryView` covering the loading spinner with `Searching…` caption, populated body via the shared `renderHistorySearchPlain` helper, the muted `No matching conversations.` body, the orange `Semantic history search requires an embedding-backed history provider.` caption, the red `HistoryErrorView` with the Retry button, the `Type a query to search history.` empty-query hint, and the `Press return to search.` after-query-but-before-submit hint). CLI is excluded from this precondition because the headless transcript at `.kota/runs/2026-05-02T23-31-34-840Z-builder-2o6c4j/history-consolidation/cli-transcript.txt` already covers every CLI arm. Daemon is excluded because the runtime probe at `.kota/runs/2026-05-02T23-31-34-840Z-builder-2o6c4j/history-consolidation/contract-probe.json` covers every wire envelope. Operator runs each visual client against a daemon (with both an empty default-provider store and an embedding-backed populated store) and commits the rendered artifacts under .kota/runs/history-consolidation-screens-<stamp>/{telegram,mobile,macos}/.
```
