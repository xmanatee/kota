---
id: task-add-web-answerpanel-consuming-the-cited-answer-sea
title: Add web AnswerPanel consuming the cited-answer seam
status: done
priority: p2
area: modules
summary: Add a sidebar AnswerPanel to the web client that consumes POST /api/answer through DaemonControlClient.answer.answer(query) and renders the synthesized prose plus a typed citation list, mirroring the just-shipped RecallPanel pattern. Second single honest surface follow-up of the answer seam after Telegram /answer; macOS and mobile adoption land later as separate tasks.
created_at: 2026-04-27T11:44:28.456Z
updated_at: 2026-04-27T11:52:44.955Z
---

## Problem

The cited-answer seam landed at commit `082c565f` with an
`AnswerProvider`, a `POST /api/answer` daemon route, the
`KotaClient.answer.answer(query, filter?)` namespace, and a
`kota answer <query>` CLI subcommand. The first single honest surface
follow-up — Telegram `/answer` — landed at commit `82a544af`. What
the operator-facing web dashboard still does not have is an answer
entry point. Today an operator watching the dashboard who wants a
composed answer to "what do I know about X?" must drop into the CLI
or switch to Telegram; the dashboard already exposes a
`RecallPanel` (commit `9a96682a`) for the source-pile view but no
parallel panel for the composed-answer view.

`/recall` and `/answer` are deliberately complementary across every
surface: `/recall` returns the ranked source pile, `/answer` returns
the resolved question with typed citations back into that pile. The
web dashboard should mirror that complementarity — a `RecallPanel`
without an `AnswerPanel` is the exact half-state the seam was built
to avoid.

## Desired Outcome

`clients/web/src/components/sidebar/AnswerPanel.tsx` renders a query
input plus a two-section result view powered by
`DaemonControlClient.answer.answer(query)`. The panel:

- Calls `answer.answer(query)` only on explicit submit (Enter or
  button); empty/whitespace queries do not fire a request.
- Renders the discriminated `AnswerResult` exhaustively with no
  `default` branch:
  - `ok: true` shows the synthesized prose first (with inline
    `[source:id]` markers preserved verbatim — the seam already
    guarantees those markers resolve against `hits`), followed by a
    typed citation list whose rows show source badge, id, score, and
    short title/preview, matching the layout the existing
    `RecallPanel` already uses for hit rows.
  - `ok: false, reason: "no_hits"` shows a single fixed message
    ("No matching sources for this question.").
  - `ok: false, reason: "semantic_unavailable"` shows a single fixed
    message ("Answer unavailable — no recall contributors registered.").
  - `ok: false, reason: "synthesis_failed"` shows a single fixed
    message ("Could not compose a cited answer for this question.").
- The citation rows resolve back to the typed `hits` in the same
  response by `{source, id}` — no broken pointers ever reach the UI
  (the seam already enforces this before returning, but the panel
  renders by lookup against `hits`, not by string-matching the prose).
- The panel is mounted in `Sidebar.tsx` next to the existing
  `RecallPanel` so the source-pile and resolved-question views sit
  side by side.
- `RecallPanel` stays as-is. `AnswerPanel` is additive — it augments
  the dashboard with a composed-answer entry point but does not
  replace the unified-recall view; both panels have distinct
  operator value.

## Constraints

- One mechanism. The panel consumes the existing
  `DaemonControlClient.answer.answer(query)` namespace exactly the
  way `RecallPanel` consumes `recall.recall(query)`; it does not
  introduce a second synthesis path, a second citation parser, a
  second prompt, or a per-store fan-out ranking in the web layer.
- Strict typed protocols. The renderer consumes the seam's
  discriminated `AnswerResult` union exhaustively (`ok: true` and the
  three `ok: false` reasons) with no `default` branch. The
  `AnswerCitation[]` is rendered by direct iteration with exhaustive
  switch on the citation source. No optional fields, no silent
  fallbacks, no per-store nullability shims in the web layer.
- Use `@tanstack/react-query` and the existing `DaemonControlClient`
  wrapper exactly like the other sidebar panels. No new HTTP layer.
- No new query types in `@/api/queries.ts` for one-shot answer; use
  the query-on-submit pattern (`useMutation` or local `useQuery`
  with an `enabled` guard against an empty query) — the same pattern
  `RecallPanel` already uses.
- Reuse the existing `answer.answer(query)` namespace; do not bypass
  it to call `POST /api/answer` directly.
- No new rendering primitives — reuse the sidebar panel layout and
  existing UI components (`Input`, `Button`, `Badge`).
- The discriminated `AnswerResult` union is the single source of
  truth for state. No legacy `null` / `undefined` aliasing for the
  unavailable branch.
- Cost signals do not flow back to the operator dashboard reply.
  Match the existing repo standing rule: no per-query cost dashboard,
  no token count surfaced into the panel.
- No legacy or compatibility shim. `AnswerPanel` ships as the only
  web surface for cited-answer composition. The render shape is the
  only render shape; no opt-in flag, no v2 path.

## Done When

- A new `AnswerPanel` component exists at
  `clients/web/src/components/sidebar/AnswerPanel.tsx`, is mounted in
  `Sidebar.tsx` next to `RecallPanel`, and consumes
  `DaemonControlClient.answer.answer`.
- All four discriminated branches (`ok: true`, `no_hits`,
  `semantic_unavailable`, `synthesis_failed`) each render their
  distinct fixed view.
- Citation rows render the typed `AnswerCitation[]` by lookup
  against `hits` in the same response, exhaustively switched on the
  citation source (`knowledge` / `memory` / `history` / `tasks`).
- A focused component test (`AnswerPanel.test.tsx`) covers all four
  branches with a stubbed `DaemonControlClient`, including a
  cited-answer fixture spanning at least two source arms.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green for the
  web client.

## Source / Intent

Follow-on to commit `82a544af` ("Add Telegram /answer command
consuming the cited-answer seam"), which finished the Telegram
surface for the answer seam and explicitly leaves macOS, mobile, and
web adoption as their own follow-ups (see
`task-add-a-cited-answer-seam-on-top-of-cross-store-reca.md`'s
`## Initiative` section). The web dashboard already has a
`RecallPanel` for the source-pile view; an operator-facing answer
entry point closes the visible gap on the dashboard surface and
keeps the recall/answer complementarity consistent across surfaces.

## Initiative

Personal-assistant answering. KOTA should answer one operator query
with one short composed answer plus typed citations into the second
brain on every operator surface, not just the CLI and Telegram. The
web dashboard is the natural second surface — the same place the
operator already runs `/recall` from a sidebar panel — and brings
the resolved-question view to the dashboard alongside the
source-pile view.

## Acceptance Evidence

- Diff for the new `AnswerPanel.tsx`, its sidebar mount, and the
  branch-coverage test file.
- Test output showing all four discriminated branches each render
  the expected view against a stubbed client, including a
  cited-answer fixture spanning at least two source arms.
- Optional screenshot capture under the run directory of the panel
  rendering against a live daemon, demonstrating a synthesized answer
  with at least two citations across two source arms.
