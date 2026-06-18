---
id: task-fan-out-consolidation-knowledge
title: Consolidate knowledge surfaces across clients
status: done
priority: p2
area: client
summary: Review the knowledge surface family across macos, mobile, telegram, web for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-06-18T13:11:44Z
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

## Consolidation Evidence (completed)

Recorded under
`.kota/runs/2026-06-18T12-52-42-920Z-builder-swebaw/knowledge-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/knowledge/routes.ts`
  `handleSearchKnowledge` covering keyword success, empty success,
  semantic success with filter forwarding, `semantic_unavailable`,
  `unknown_project`, and provider-thrown failure. The success and unavailable
  arms are decoded through the shared TypeScript conformance decoder into the
  four-field cross-client projection (`id`, `type`, `status`, `title`).
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — current source-mode CLI transcript covering top-level
  `knowledge` discoverability, `knowledge --help`, `list --help`,
  `search --help`, add/search/show/delete of a transient probe entry, the
  typed `Semantic knowledge search requires an embedding-backed knowledge
  provider.` unavailable arm, and a post-delete search proving cleanup.
- `probe-cli.mjs` and `cli-summary.json` — CLI probe source plus command status
  summary.
- `verdict.md` — written verdict for each of the 8 consolidation dimensions.

Rendered/operator evidence is recorded under
`.kota/runs/2026-06-18T12-52-42-920Z-builder-swebaw/knowledge-consolidation/surfaces/`:

- `telegram/*.md` are rendered message fixtures generated by the Telegram
  `/knowledge` handler tests for usage, populated, no-match, and
  semantic-unavailable replies.
- `mobile/knowledge-screen-rendered.json` is a React Native rendered tree
  fixture for `KnowledgeScreen` covering empty query, populated, empty,
  semantic-unavailable, HTTP retry, and offline states.
- `macos/rendered-menu-bar-states.txt` is a Swift snapshot fixture generated
  by `MenuBarRenderedTests`, including the Ask group's Knowledge mode and
  semantic-unavailable state coverage.
- `web/*.html` are rendered `KnowledgePanel` HTML fixtures for populated,
  empty, and semantic-unavailable states.

Follow-ups and prior gaps are closed:

- `data/tasks/done/task-replace-web-knowledgepanel-stale-shape-with-cross-.md`
  replaced the stale embedded web `KnowledgePanel` shape with the shared
  `GET /api/knowledge/search` seam.
- `data/tasks/done/task-share-or-conformance-test-daemon-wire-contracts-ac.md`
  closed the broader cross-client conformance and decoder-drift gap.

The knowledge module's `src/modules/knowledge/AGENTS.md` currently names
Telegram `/knowledge`, terminal `kota knowledge search`, mobile
`KnowledgeScreen`, macOS `KnowledgeView`, and embedded web `KnowledgePanel`
as consumers of one shared HTTP route and line shape.

No open evidence blocker or knowledge-specific follow-up remains.
