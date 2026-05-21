---
id: task-fan-out-consolidation-knowledge
title: Consolidate knowledge surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the knowledge surface family across macos, mobile, telegram, web for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-07T00:00:00.000Z
---

## Problem

The `knowledge` capability shipped across 4 client surfaces
(macos, mobile, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `knowledge`

Surfaces shipped:

- macos
- mobile
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-a-telegram-knowledge-command-for-ad-hoc-semant (telegram, closed 2026-04-26T09:54:48.328Z) — Add a Telegram /knowledge command for ad-hoc semantic knowledge search
- task-add-macos-menu-bar-knowledgeview-consuming-daemonc (macos, closed 2026-04-26T23:57:32.119Z) — Add macOS menu-bar KnowledgeView consuming DaemonClient.searchKnowledge
- task-add-mobile-knowledgescreen-consuming-searchknowled (mobile, closed 2026-04-27T00:16:06.320Z) — Add mobile KnowledgeScreen consuming searchKnowledge
- task-replace-web-knowledgepanel-stale-shape-with-cross- (web, closed 2026-05-03T03:51:23.298Z) — Replace web KnowledgePanel stale shape with cross-store knowledge contract

## Desired Outcome

The `knowledge` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `knowledge` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `knowledge` capability
landed across 4 client surfaces between 2026-04-26T09:54:48.328Z
and 2026-05-03T03:51:23.298Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-05-02T23-48-49-379Z-builder-xqo3ac/knowledge-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/knowledge/routes.ts`
  `handleSearchKnowledge` exercising the six envelope arms every fan-out
  client decodes through the shared seam: `semantic-true-unsupported` (200
  with `{ ok: false, reason: "semantic_unavailable" }` against a provider
  that returns `supportsSemanticSearch()=false`, the default file-based
  `KnowledgeStore`), `semantic-true-supported` (200 with `{ ok: true,
  entries: [...] }` carrying the full daemon-side `KnowledgeEntry`
  projection, narrowed by every client decoder to the four-field
  cross-client projection `id`, `type`, `status`, `title`),
  `semantic-true-empty` (200 with `{ ok: true, entries: [] }`),
  `semantic-true-filter-forwarding` (asserts `tag`, `type`, `status`, and
  `scope=project|global|all` reach `provider.semanticSearch` as
  `{ tag, type, status, scope }` per `routes.ts:118-130`),
  `keyword-fallback` (`semantic=false` routes through
  `provider.search(query, filters).slice(0, limit)` and returns the same
  envelope), and `provider-throws` (500 typed `{ error: <message> }`).
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — `pnpm kota --help` discoverability (proves
  `knowledge` is in the top-level command inventory), full
  `pnpm kota knowledge --help` / `list --help` / `search --help` /
  `show --help` surfaces, plus live `list` / `list -n 5` /
  `list --tag missing` / `search 'harness'` / `search 'harness' --semantic`
  (typed `Semantic knowledge search requires an embedding-backed knowledge
  provider.`, exit 1) / `show missing-id` (`Knowledge entry "missing-id"
  not found.`, exit 1) / `add` (transient `Probe entry` written and
  cleaned up after capture) / `delete missing-id` /
  `add --scope bogus` (typed input validation, exit 1) /
  `reindex` (no-provider skip line) / `export --format json`
  (full JSON dump of existing entries) runs against the live KOTA
  project store. Confirms the CLI surface decodes the same
  `{ ok: true, entries }` / `{ ok: false, reason: "semantic_unavailable" }`
  envelopes the visual clients mirror.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

Follow-ups and prior gaps:

- `task-replace-web-knowledgepanel-stale-shape-with-cross-` is now done.
  The embedded web `KnowledgePanel` consumes the shared
  `GET /api/knowledge/search` seam and renders the same four-field line
  projection as the other operator pull-surfaces.
- `task-share-or-conformance-test-daemon-wire-contracts-ac` is also done;
  the cross-client conformance fixture and decoder mirrors now cover this
  class of daemon wire-contract drift.

The knowledge module's `src/modules/knowledge/AGENTS.md`
"Operator pull-surfaces" line now includes Telegram `/knowledge`,
terminal `kota knowledge search`, mobile `KnowledgeScreen`, macOS
`KnowledgeView`, and the embedded web sidebar `KnowledgePanel`.

The macOS `KnowledgeView` and mobile `KnowledgeScreen` fan-out
commits were spot-checked for accepted critic warnings; neither
relied on a markdown-description-instead-of-screenshots substitution.
The visual-evidence gap is captured by the operator-capture
precondition below, not as a separate retirement plan.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/knowledge-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the live knowledge-search visual surfaces — telegram (`/knowledge` against an empty store rendering `No matching knowledge entries.`, `/knowledge` against an embedding-backed populated store rendering the shared `id  type  status  title` line shape, `/knowledge` against the default file-based provider rendering the typed `Semantic knowledge search requires an embedding-backed knowledge provider.` body, and the `Usage: /knowledge <query>` hint for empty/whitespace input), mobile (`KnowledgeScreen` covering loading via the RefreshControl, populated list with the shared line shape, empty list with the `No matching knowledge entries.` label, the typed `semantic_unavailable` orange banner, error retry, offline banner, the `Type a query and tap Search to query knowledge.` empty-query hint, and the cleared-on-reset state), macOS (`KnowledgeView` covering the loading spinner with `Searching...` caption, populated body via the shared `renderKnowledgeSearchPlain` helper, the muted `No matching knowledge entries.` body, the orange `Semantic knowledge search requires an embedding-backed knowledge provider.` caption, the red `KnowledgeErrorView` with the Retry button, the `Type a query to search knowledge.` empty-query hint, and the `Press return to search.` after-query-but-before-submit hint), and web (`KnowledgePanel` covering populated semantic results, empty results, semantic-unavailable caption, and retry/error state through the shared `/api/knowledge/search` seam). CLI is excluded from this precondition because the headless transcript at `.kota/runs/2026-05-02T23-48-49-379Z-builder-xqo3ac/knowledge-consolidation/cli-transcript.txt` already covers every CLI arm. Daemon is excluded because the runtime probe at `.kota/runs/2026-05-02T23-48-49-379Z-builder-xqo3ac/knowledge-consolidation/contract-probe.json` covers every wire envelope. Operator runs each visual client against a daemon (with both an empty default-provider store and an embedding-backed populated store) and commits the rendered artifacts under .kota/runs/knowledge-consolidation-screens-<stamp>/{telegram,mobile,macos,web}/.
```

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-05-21T02:10:03.450Z -->
