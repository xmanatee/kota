---
id: task-add-web-client-attention-panel-consuming-apiattent
title: Add web client attention panel consuming /api/attention
status: ready
priority: p2
area: modules
summary: Add an Attention sidebar panel in the embedded web client that calls GET /api/attention and renders the same on-demand attention body the Telegram /attention, kota attention CLI, and daemon HTTP route already share, completing the web consumer of the attention-digest on-demand seam.
created_at: 2026-04-26T08:28:44.699Z
updated_at: 2026-04-26T08:28:44.699Z
---

## Problem

The `attention-digest` workflow's on-demand seam (`renderOnDemandAttention`
in `src/modules/autonomy/workflows/attention-digest/step.ts`) now backs three
of the four primary operator pull-surfaces:

- Telegram `/attention` slash command (commit `3090d2c6`).
- Terminal `kota attention` command, JSON and text modes (commit `50e12ddf`).
- Daemon HTTP `GET /api/attention` route returning
  `{ data: { items: AttentionItem[] }, text: string }` (commit `50a217fa`),
  contributed via `attentionRoutes(...)` in `src/modules/autonomy/index.ts`
  alongside `digestRoutes(...)`.

The fourth — the embedded web client served by `kota serve` — is the only
operator pull-surface still uncovered. `clients/web/src/components/sidebar/
Sidebar.tsx` exposes a `DigestPanel` and panels for Overview, Sessions,
History, Approvals, Owner Questions, Tasks, Workflows, Active Sessions,
Workflow Definitions, Schedules, Analytics, Knowledge, Memory, Guardrail
Audit, Modules, and Config; there is no Attention panel and
`clients/web/src/api/client.ts` / `clients/web/src/api/queries.ts` have a
`getDigest()` + `digestQuery` but no `/api/attention` consumer. Operators
who supervise KOTA from the daemon-backed web UI today cannot read the
current attention rollup without falling back to a terminal or chat
surface, even though the daemon is already serving the body.

The just-completed `task-add-daemon-http-attention-endpoint-consuming-the-o`
explicitly named "web/native attention panels" as the next surfaces in the
fan-out, and the `daily-digest` initiative completed exactly this fan-out
in this same order across seven surfaces (Telegram → CLI → daemon HTTP →
web → macOS → mobile → push); the web panel is the next step in the
established cadence.

## Desired Outcome

The embedded web client gains an Attention surface — an `AttentionPanel`
in the sidebar — that calls `GET /api/attention`, renders the same
operator-facing rollup the other three surfaces emit, and shows the same
"nothing to attend to" reply (`NO_ATTENTION_ITEMS_TEXT`) the on-demand
seam already returns when no items qualify. The panel uses the existing
TanStack Query stack and bearer-token auth path that every other panel
uses; it does not introduce a parallel data layer or a duplicate detector.
The same body parity invariant that holds across Telegram / CLI / daemon
HTTP holds across web — a single on-demand seam, four pull-surfaces.

## Constraints

- Reuse the existing daemon API client (`clients/web/src/api/client.ts`)
  and TanStack Query patterns (`clients/web/src/api/queries.ts`). Add a
  typed `getAttention()` method and an `attentionQuery` (or equivalent),
  not a bespoke `fetch` call inside the component. Mirror the existing
  `getDigest()` + `digestQuery` shape.
- Reuse the structured `AttentionItem[]` shape returned by
  `renderOnDemandAttention` for typing on the client side. Do not redeclare
  a parallel response type. Either publish the type for client consumption
  (see `clients/web/AGENTS.md` on the typed client/daemon contract) or
  import it through the existing shared-types path the digest panel uses.
- Honor the on-demand seam invariants enforced by the route: the client
  must never assume the GET writes
  `<runsDir>/../attention-digest-counter.json` or emits
  `workflow.attention.digest`, and the rendered body must not flow into
  any agent prompt path. The web client never reads `.kota/` files
  directly (`clients/web/AGENTS.md`), and that boundary is preserved.
- Auth model matches the rest of `/api/*`: requests carry the existing
  bearer token via `authHeaders()`. No per-route bypass.
- One mechanism. Either a sidebar panel, a routed `/attention` view, or
  both, but the rendering of the attention body lives in one component
  consumed by every entry point. No duplicated render path. Mirror the
  digest panel's choice for consistency.
- No backwards-compatibility shim for older daemon builds that lack
  `/api/attention`. If the route 404s, surface the daemon's typed error
  one-to-one the way `DigestPanel` already surfaces its daemon failure
  mode.
- Per the no-cost-bias-in-autonomy memory and the workflow's
  `agent-feed invariant`, this body is operator-facing only. Do not
  expose the panel's response in any context that flows into an autonomy
  agent prompt.

## Done When

- An `AttentionPanel` component lives under
  `clients/web/src/components/sidebar/` and is wired into `Sidebar.tsx`
  alongside `DigestPanel` so operators can read the current attention
  rollup without leaving the web UI.
- `clients/web/src/api/client.ts` has a typed `getAttention()` method
  returning `{ data: { items: AttentionItem[] }, text: string }` and
  `clients/web/src/api/queries.ts` exposes an `attentionQuery` keyed
  under `queryKeys.attention`.
- The panel renders the same body the daemon serves: at minimum the
  rendered text, plus a count or empty-state label driven by
  `data.items.length` when zero (so operators distinguish "nothing
  pending" from "request failed").
- A component-level test under `clients/web/` exercises the panel with
  a mocked `/api/attention` response (items-present and empty-items
  payloads) and asserts the panel surfaces the daemon's typed error
  path when the route fails. Mirror `DigestPanel.test.tsx`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green for the web
  client.
- Documentation aligned: `src/modules/autonomy/workflows/attention-digest/
  AGENTS.md`'s On-Demand Seam section names the web client as the fourth
  consumer (one-line update, not a duplicated catalog), and
  `clients/web/AGENTS.md` does not need to enumerate the new panel —
  the generic "consumes only the daemon HTTP+JSON API" guidance already
  covers it.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-26T08-27-00-612Z-explorer-us5xpf/` immediately after
the daemon `/api/attention` route landed (commit `50a217fa`,
"Add `GET /api/attention` daemon HTTP endpoint consuming the on-demand
attention seam"). The just-completed daemon-route task explicitly named
"web/native attention panels" as the next consumers; the on-demand seam
was specifically designed so any pull-surface renders the same body
without drift, and the embedded web client is the only remaining primary
operator pull-surface that does not consume it. Without this task, the
daemon endpoint is shipped but unused by the operator surface that is
supposed to use it. The `daily-digest` precedent
(`task-add-web-client-digest-panel-consuming-apidigest`, commit
`7d423e76`) is the exact template — same shape, same invariants, same
typed-client contract.

## Initiative

Operator-pull parity for the attention digest: every primary operator
surface (Telegram, terminal, daemon HTTP, web/native clients) shares one
on-demand attention body via `renderOnDemandAttention`, with
surface-specific delivery wired through standard module patterns rather
than per-surface duplication. The macOS menu bar `AttentionView` and
mobile `AttentionScreen` follow as their own tasks once this lands,
mirroring the digest fan-out's web → macOS → mobile order.

## Acceptance Evidence

- Diff covering the new `AttentionPanel`, the typed `getAttention()` API
  method, the `attentionQuery` registration, the wiring into
  `Sidebar.tsx`, and the component-level test.
- Screenshot or rendered DOM snapshot under `.kota/runs/<run-id>/` of the
  panel against an items-present fixture and an empty-items fixture,
  paired alongside the corresponding `kota attention` text and Telegram
  `/attention` text from the same project state to demonstrate body
  parity across surfaces.
- Test output showing the new component-level test passing.
