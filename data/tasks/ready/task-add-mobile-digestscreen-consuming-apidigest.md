---
id: task-add-mobile-digestscreen-consuming-apidigest
title: Add mobile DigestScreen consuming /api/digest
status: ready
priority: p2
area: client
summary: Add a Digest screen to the React Native mobile client that calls GET /api/digest through DaemonClient and renders the same on-demand digest body the Telegram /digest, kota digest CLI, daemon HTTP route, web DigestPanel, and macOS DigestView already share, completing operator-pull parity for the daily-digest seam across every primary native operator surface.
created_at: 2026-04-26T05:38:28.009Z
updated_at: 2026-04-26T05:38:28.009Z
---

## Problem

The `daily-digest` workflow's on-demand seam (`renderOnDemandDigest` in
`src/modules/autonomy/workflows/daily-digest/on-demand.ts`) now backs five
of the six primary operator pull-surfaces named in the initiative:

- Telegram `/digest` slash command (commit `68451bf5`).
- Terminal `kota digest` command, JSON and text modes (commit `ac5ba758`).
- Daemon HTTP `GET /api/digest` returning `{ data: DailyDigestData, text:
  string }` (commit `bbe6c50c`).
- Embedded web client `DigestPanel` (commit `7d423e76`).
- macOS menu bar `DigestView` (commit `19552628`).

The React Native mobile client is the only primary native operator
surface still uncovered. `clients/mobile/src/daemonClient.ts` exposes
typed methods for `/health`, `/status`, `/workflow/runs`, approvals,
owner questions, tasks, sessions, voice, and chat, but no
`getDigest()`. `clients/mobile/src/screens/` ships Status, Runs,
Approvals, OwnerQuestions, Tasks, Chat, RunDetail, ApprovalDetail,
ChatDetail, ChatList, and Settings screens — no Digest screen.
`clients/mobile/src/navigation/` registers no Digest tab. Operators
who supervise KOTA on the go from their phone today have to context-
switch to a terminal, browser, macOS menu bar, or chat surface to read
the 24h rollup, even though the daemon is already serving the body.

## Desired Outcome

The mobile client gains a Digest surface — a `DigestScreen` rendered
from the bottom-tab navigator (or accessible from an existing tab in a
way consistent with how the other screens are reached) — that calls
`GET /api/digest`, renders the same operator-facing rollup the other
five surfaces emit, and labels quiet windows distinctly using the
response payload's `quiet` flag. The screen uses the existing
`DaemonClient`/`DaemonContext` path that every other screen uses; it
does not introduce a parallel data layer or duplicate aggregation. The
same body parity invariant that holds across Telegram / CLI / daemon
HTTP / web / macOS holds across mobile — a single on-demand seam, six
pull-surfaces. This closes the operator-pull-parity-for-the-daily-
digest initiative.

## Constraints

- Reuse the existing `DaemonClient`
  (`clients/mobile/src/daemonClient.ts`) and `DaemonContext`
  (`clients/mobile/src/context/DaemonContext.tsx`) patterns. Add a
  typed `getDigest()` method and the corresponding `DailyDigestData`
  types in `clients/mobile/src/types.ts`, not an ad-hoc `fetch` call
  inside the screen.
- Mirror the `DailyDigestData` shape exported from
  `src/modules/autonomy/workflows/daily-digest/aggregate.ts`. Decode it
  through TypeScript types in `types.ts`. Do not invent a parallel
  response type that drifts from the daemon's contract.
- The `quiet` boolean on the response payload labels quiet-window
  output distinctly in the UI (badge, header, or icon). Do not branch
  on the rendered text body to infer quiet state.
- Auth model matches the rest of `DaemonClient`: requests carry the
  bearer token via the existing `request<T>()` helper. No per-route
  bypass.
- The on-demand seam invariants enforced by the route stay intact: the
  client must never assume the GET writes
  `.kota/daily-digest-state.json` or emits `workflow.daily.digest`,
  and the rendered body must not flow into any agent prompt path. The
  mobile client never reads `.kota/` files directly
  (`clients/mobile/AGENTS.md`), and that boundary is preserved.
- One mechanism. A single `DigestScreen` consumed from the navigator,
  not two duplicated render paths.
- No backwards-compatibility shim for older daemon builds that lack
  `/api/digest`. If the route 404s, surface the daemon's typed error
  one-to-one the way approvals/owner-questions screens already surface
  their daemon failure modes.
- If the `DaemonClient` hits an HTTP error, the screen shows the same
  offline/error state pattern other screens use; it must not preserve
  a stale digest across an offline transition.

## Done When

- A `DigestScreen.tsx` lives under `clients/mobile/src/screens/` and
  is wired into the navigator (`clients/mobile/src/navigation/`) so
  operators can read the 24h rollup without leaving the mobile app.
- `daemonClient.ts` has a typed `getDigest()` returning the
  `{ data, text }` shape, and `types.ts` declares the
  `DailyDigestData` mirror plus its nested types.
- `DaemonContext` (or the equivalent state path used by other
  screens) exposes the digest as observable state with refresh-on-
  demand semantics consistent with neighboring screens; the screen
  renders the same body the daemon serves: at minimum the rendered
  text plus a quiet-window label driven by `data.quiet`.
- Tests under `clients/mobile/src/__tests__/` exercise
  `daemonClient.getDigest()` (active and quiet payloads) and assert
  the typed error path when the route fails, paired with the existing
  `daemonClient.test.ts` patterns. A focused `DigestScreen.test.tsx`
  asserts the quiet-label behavior parallel to `StatusScreen.test.tsx`.
- `pnpm test` is green for the mobile client.
- Documentation aligned: `src/modules/autonomy/workflows/daily-digest/
  AGENTS.md`'s On-Demand Seam section names the mobile client as the
  sixth consumer (one-line update, not a duplicated catalog).
  `clients/mobile/AGENTS.md` does not need to enumerate the new
  screen — the generic "all state comes from the daemon control API"
  guidance already covers it.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-26T05-36-53-264Z-explorer-tc2vkr/` immediately
after the macOS `DigestView` task landed (commit `19552628`). The
operator-pull-parity initiative explicitly enumerates Telegram,
terminal, daemon HTTP, web, macOS, and mobile as the six primary
operator pull-surfaces; five have shipped, mobile is the last.
Without this task, the daemon endpoint ships everywhere except the
on-the-go phone surface, where the always-near-the-operator promise
of mobile is least served by the existing Telegram fallback (chat
flow vs structured rollup).

## Initiative

Operator-pull parity for the daily digest: every primary operator
surface (Telegram, terminal, daemon HTTP, web, macOS, mobile) shares
one on-demand digest body via `renderOnDemandDigest`, with surface-
specific delivery wired through standard module patterns rather than
per-surface duplication. This task closes the initiative.

## Acceptance Evidence

- Diff covering the new `DigestScreen.tsx`, the typed `getDigest()`
  on `DaemonClient`, the `DailyDigestData` mirror in `types.ts`, the
  `DaemonContext`/state wiring, the navigator registration, and the
  added test cases in `clients/mobile/src/__tests__/`.
- Screenshot under `.kota/runs/<run-id>/` of the mobile client
  rendering an active digest fixture and a quiet-window fixture,
  paired alongside the corresponding `kota digest` text and macOS
  `DigestView` rendering from the same project state to demonstrate
  body parity across the now-six surfaces.
- Test output showing the new `daemonClient.getDigest()` and
  `DigestScreen` cases passing under `pnpm test`.
