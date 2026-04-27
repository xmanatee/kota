---
id: task-add-web-recallpanel-consuming-recall-daemon-route
title: Add web RecallPanel consuming /recall daemon route
status: done
priority: p2
area: modules
summary: Add a sidebar RecallPanel to the web client that consumes POST /recall through DaemonControlClient.recall.recall(query) and renders ranked, source-tagged hits, mirroring the existing AttentionPanel/DigestPanel pattern.
created_at: 2026-04-27T08:16:37.823Z
updated_at: 2026-04-27T08:26:01.466Z
---

## Problem

The cross-store recall seam now ships across the daemon-control surface,
the `kota recall` CLI, and Telegram `/recall`, but the operator-facing
web client has no entry point. An operator watching the dashboard cannot
ask one natural-language query against knowledge, memory, history, and
the repo task queue at once — they have to run the CLI, switch to
Telegram, or open a per-store panel and search each separately.

## Desired Outcome

`clients/web/src/components/sidebar/RecallPanel.tsx` renders a search
input plus a ranked, source-tagged list of hits from
`DaemonControlClient.recall.recall(query)`. The panel:

- Calls `recall.recall(query)` only on explicit submit (Enter or
  button); empty/whitespace queries do not fire a request.
- Renders the discriminated `RecallResult`: `ok: false` with
  `reason: "semantic_unavailable"` shows a single fixed message
  ("Recall unavailable — no contributors registered"), and
  `ok: true` with zero hits shows "No matching hits."
- Each hit row shows the source badge (`knowledge` / `memory` /
  `history` / `tasks`), a short title or excerpt, and the normalized
  score. Source ordering reuses the seam's `RECALL_SOURCE_ORDER`
  tie-break — the panel does not re-sort.
- The panel is mounted in `Sidebar.tsx` next to the per-store panels.

## Constraints

- Use `@tanstack/react-query` and the existing `DaemonControlClient`
  wrapper exactly like the other sidebar panels — no new HTTP layer.
- No new query types in `@/api/queries.ts` for one-shot search; use the
  query-on-submit pattern (`useMutation` or local `useQuery` with an
  `enabled` guard against an empty query).
- Reuse the existing `recall.recall(query)` namespace; do not bypass it
  to call `POST /recall` directly.
- No new rendering primitives — reuse the sidebar panel layout and
  existing UI components (`Input`, `Button`, `Badge`).
- The discriminated `RecallResult` union is the single source of truth
  for state. No legacy `null` / `[]` aliasing for the unavailable
  branch.

## Done When

- A new `RecallPanel` component exists, is mounted in the sidebar, and
  consumes `DaemonControlClient.recall.recall`.
- The three branches (`semantic_unavailable`, empty hits, ranked hits)
  each render their distinct fixed view.
- A focused component test (`RecallPanel.test.tsx`) covers all three
  branches with a stubbed `DaemonControlClient`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green for the web
  client.

## Source / Intent

Follow-on to commit `6510f998` ("Add Telegram /recall and surface
seam-unavailability in RecallResult"), which finished the Telegram
surface for the recall seam and explicitly leaves macOS, mobile, and
web adoption as their own follow-ups (see
`src/modules/recall/AGENTS.md`). The web client already has parallel
sidebar panels for every per-store search; an operator-facing recall
entry point closes the visible gap on the dashboard surface.

## Initiative

Cross-store recall fan-out: deliver the unified recall seam through
every operator surface (CLI, Telegram, web, macOS menu bar, mobile)
so a single natural-language query is reachable wherever the operator
is watching.

## Acceptance Evidence

- Diff for the new `RecallPanel.tsx`, its sidebar mount, and the
  branch-coverage test file.
- Test output showing the three discriminated branches each render
  the expected view against a stubbed client.
- Optional screenshot capture under the run directory of the panel
  rendering against a live daemon, demonstrating ranked hits across at
  least two source kinds.
