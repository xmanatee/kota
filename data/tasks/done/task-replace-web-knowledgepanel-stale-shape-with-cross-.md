---
id: task-replace-web-knowledgepanel-stale-shape-with-cross-
title: Replace web KnowledgePanel stale shape with cross-store knowledge contract
status: done
priority: p3
area: client
summary: Web sidebar KnowledgePanel renders fields (category, createdAt) absent from the daemon's KnowledgeEntry contract and consumes /api/knowledge instead of the shared search seam; rewrite to consume GET /api/knowledge/search with the four-field cross-client projection.
created_at: 2026-05-02T23:55:44.166Z
updated_at: 2026-05-03T03:51:23.298Z
---

## Problem

The web sidebar `KnowledgePanel` (`clients/web/src/components/sidebar/KnowledgePanel.tsx`)
predates the cross-store knowledge fan-out and silently disagrees with the
daemon's wire contract on two axes:

1. **Wrong endpoint.** It hits `GET /api/knowledge` (the list route) via
   `knowledgeQuery` → `api.getKnowledge()` (`clients/web/src/api/queries.ts:123`,
   `clients/web/src/api/client.ts:293`), not `GET /api/knowledge/search` —
   the shared search seam every other operator pull-surface (Telegram
   `/knowledge`, terminal `kota knowledge search`, mobile `KnowledgeScreen`,
   macOS `KnowledgeView`) consumes.
2. **Wrong entry shape.** Its locally declared `KnowledgeEntry` type
   (`clients/web/src/api/types.ts:250-256`) is `{ id, title, category,
   content, createdAt }`. The daemon's actual `KnowledgeEntry` (per
   `src/core/modules/provider-types.ts:38-49` and the cross-client
   conformance fixture `clients/conformance/contract-fixture.json`
   `knowledgeSearch.success.entries[]`) is `{ id, title, type, tags, status,
   created, updated, content, meta }`. The web client's `e.category` and
   `e.createdAt` field reads in `KnowledgePanel.tsx:13` and
   `KnowledgePanel.tsx:32` are undefined at runtime against any real daemon
   response, so the panel renders a blank "category" caption per row.

This was surfaced by the 2026-05-02 knowledge fan-out consolidation review
(`.kota/runs/2026-05-02T23-48-49-379Z-builder-xqo3ac/knowledge-consolidation/`).
The web `KnowledgePanel` was wrongly listed in `src/modules/knowledge/AGENTS.md`
as a search-seam consumer, masking the drift.

## Desired Outcome

The web `KnowledgePanel` consumes the same shared `GET /api/knowledge/search`
seam every other operator pull-surface uses, decodes the discriminated
`{ ok: true, entries }` / `{ ok: false, reason: "semantic_unavailable" }`
response, and renders the four-field cross-client projection
(`id`, `type`, `status`, `title`) so the sidebar surface matches Telegram,
CLI, mobile, and macOS line shape exactly. The local `KnowledgeEntry` type
in `clients/web/src/api/types.ts` is aligned with the daemon's actual
contract, with the closed `KnowledgeSearchResponse` discriminated union
mirroring the mobile `parseKnowledgeSearchResponse` and macOS
`KnowledgeSearchResponse` Codable.

## Constraints

- Do not introduce a parallel `KnowledgeEntry` shape — the web client should
  reuse the four-field projection the conformance fixture pins.
- Do not add a new daemon route. The shared seam is `GET /api/knowledge/search`.
- Strict decode: payload drift must throw rather than silently degrade.
- Update `clients/conformance/contract-fixture.json` if a new web-only
  arm needs to be pinned, but the four existing arms (`success`,
  `semanticUnavailable`, `negative_unknownReason`) should be enough.

## Done When

1. `clients/web/src/components/sidebar/KnowledgePanel.tsx` consumes a query
   that targets `GET /api/knowledge/search` with `semantic=true&limit=…`
   and decodes the `{ ok: true, entries } | { ok: false, reason:
   "semantic_unavailable" }` envelope.
2. `clients/web/src/api/types.ts` `KnowledgeEntry` matches the four-field
   cross-client projection (`id`, `type`, `status`, `title`) — no
   `category` / `createdAt` fields.
3. `KnowledgePanel.tsx` renders the same four-column line shape the
   shared `renderKnowledgeSearchPlain` helper produces, plus the
   `Semantic knowledge search requires an embedding-backed knowledge
   provider.` caption for the `semantic_unavailable` arm.
4. The web client's contract-fixture test (`clients/web/src/api/contractFixture.test.ts`
   or equivalent) exercises the new decoder against the fixture's
   `knowledgeSearch.success` and `knowledgeSearch.semanticUnavailable`
   arms.
5. Rendered evidence: a Playwright trace, screenshot, or DOM snapshot
   under `.kota/runs/<run-id>/` showing the panel against (a) a
   populated semantic-supported provider, (b) the empty-result state,
   and (c) the `semantic_unavailable` caption.
6. `src/modules/knowledge/AGENTS.md` "Operator pull-surfaces" line is
   updated to reflect that `KnowledgePanel` is once again a true
   search-seam consumer (the consolidation review temporarily dropped
   it pending this task).

## Source / Intent

Surfaced by the 2026-05-02 knowledge fan-out consolidation review
(`.kota/runs/2026-05-02T23-48-49-379Z-builder-xqo3ac/knowledge-consolidation/verdict.md`,
dimension 3 "Duplicated route/error/rendering logic" / dimension 6
"Stale legacy affordances"). The web sidebar was claimed to be a
search-seam consumer in `src/modules/knowledge/AGENTS.md` but actually
hits the list endpoint with a stale custom shape, producing blank-
category rows at runtime. p3 because the panel still renders something
(titles), the regression is silent rather than crashing, and no operator
has reported it; but the fix is small and removes a real cross-client
contract divergence.

## Initiative

Cross-client wire-contract parity. Pairs with
`task-share-or-conformance-test-daemon-wire-contracts-ac` (the umbrella
that the conformance fixture and per-client decoders satisfy).

## Acceptance Evidence

- Rendered DOM snapshot or Playwright screenshot under
  `.kota/runs/<run-id>/web-knowledgepanel/` showing the populated
  semantic results, empty-result state, and `semantic_unavailable`
  caption.
- Updated `clients/conformance/contract-fixture.json` arms wired into
  the web contract-fixture test (transcript or test output).
- Diff cleanly removes the `category` / `createdAt` fields from
  `clients/web/src/api/types.ts` `KnowledgeEntry`.
