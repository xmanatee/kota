---
id: task-add-mobile-attentionscreen-consuming-apiattention
title: Add mobile AttentionScreen consuming /api/attention
status: done
priority: p2
area: modules
summary: Add an AttentionScreen in the mobile client (mirroring DigestScreen) that calls GET /api/attention and renders the same on-demand attention body the Telegram /attention, kota attention CLI, daemon HTTP route, and web AttentionPanel already share, and extend the push-notification screen union and workflow.attention.digest fan-out to deep-link into the new screen instead of co-mingling with the daily-digest screen.
created_at: 2026-04-26T09:05:45.023Z
updated_at: 2026-04-26T09:23:41.770Z
---

## Problem

The `attention-digest` workflow's on-demand seam now backs four operator
pull-surfaces (Telegram `/attention`, `kota attention`, daemon HTTP
`GET /api/attention`, and the embedded web `AttentionPanel`). The
mobile client is the next-but-one surface in the established cadence.
`clients/mobile/src/screens/DigestScreen.tsx` exposes the digest body;
the navigation map (`clients/mobile/src/navigation/index.tsx`) registers
a `Digest` screen; `clients/mobile/src/context/DaemonContext.tsx` exposes
`refreshDigest`, `digest`, `digestLoading`, and `digestError` state.
There is no equivalent `AttentionScreen`, no `attention*` state on
`DaemonContext`, and no `getAttention` call against the daemon route the
other surfaces consume.

In parallel, the push-notification module
(`src/modules/push-notification/send.ts`, line 30–31) declares the
client-side deep-link union as `{ screen: "approvals"; approvalId } |
{ screen: "digest" }`, and `src/modules/push-notification/index.ts`
fans `workflow.attention.digest` onto `data.screen = "digest"` (verified
by `index.test.ts:7` and `:159`). Operators tapping an attention push
notification therefore land on the daily-digest screen, not on a screen
showing the same body the other four attention surfaces show. With the
new `AttentionScreen` in place, the deep-link should target it directly
so the push surface stays consistent with the rest of the attention
seam.

The just-completed web AttentionPanel task explicitly named the mobile
attention surface as the next step after macOS, and the daily-digest
initiative completed exactly this fan-out across seven surfaces (Telegram
→ CLI → daemon HTTP → web → macOS → mobile → push); the mobile screen
plus the push deep-link extension are the remaining two steps.

## Desired Outcome

The mobile client gains an AttentionScreen — a navigation-mounted screen
mirroring `DigestScreen` — that calls `GET /api/attention` through the
daemon HTTP client, exposes the result on `DaemonContext` under
`attention`/`attentionLoading`/`attentionError` state with a
`refreshAttention()` method, and renders the same on-demand attention
body (`text` plus `data.items`) the other four surfaces emit, including
the empty-state copy.

The push-notification module's `screen` union extends to include
`{ screen: "attention" }`, the `workflow.attention.digest` fan-out routes
to `data.screen = "attention"` (with the existing attention-posture
title preserved), and `clients/mobile/src/navigation/routeNotificationResponse.ts`
maps the new screen to the AttentionScreen route, so a tap on an
attention push lands the operator on the AttentionScreen rather than the
DigestScreen.

## Constraints

- Build on the existing `DaemonContext`, navigation map, and screen
  composition; do not add a parallel state container, navigation stack,
  or HTTP client just for attention.
- Reuse the same daemon HTTP route (`GET /api/attention`) the web/CLI/
  Telegram surfaces already consume. Do not introduce a second attention
  seam, model, or text formatter on the mobile side.
- Match DigestScreen's interaction discipline: pull-to-refresh, explicit
  loading/error/quiet/active states, no eager fetch when the daemon is
  offline.
- Keep the AttentionScreen visually consistent with DigestScreen so the
  two pull-surfaces feel like one family.
- The push-notification deep-link change is strict: extend the discriminated
  union, do not loosen it. No silent fallback from `screen=attention` back
  to `screen=digest`. Update the existing `workflow.attention.digest` test
  in `src/modules/push-notification/index.test.ts` rather than adding a
  parallel one.
- Preserve the existing daily-digest push deep-link (`workflow.daily.digest`
  must still target `screen=digest`); the change is additive on the
  attention path only.
- Respect the typed mobile reducer state (`clients/mobile/src/context/state.ts`)
  and route-decoding tests (`clients/mobile/src/__tests__/routeNotificationResponse.test.ts`);
  add coverage for the new screen rather than relaxing existing assertions.

## Done When

- `clients/mobile/src/screens/AttentionScreen.tsx` renders an
  AttentionScreen, registered in the navigation map and reachable from
  the existing menu/tab structure.
- `DaemonContext` exposes `attention`, `attentionLoading`, `attentionError`,
  and `refreshAttention()` matching the digest shape, with reducer
  coverage in `clients/mobile/src/__tests__/reducer.test.ts`.
- The mobile API client adds a `getAttention()` call against the daemon
  HTTP route, returning the same `{ data: { items: AttentionItem[] },
  text: string }` envelope the other surfaces consume.
- `clients/mobile/src/__tests__/AttentionScreen.test.tsx` covers the
  populated-items state, the empty-state copy
  (`NO_ATTENTION_ITEMS_TEXT`), and the error state.
- `src/modules/push-notification/send.ts` extends the screen
  discriminated union to include `{ screen: "attention" }`, the
  `workflow.attention.digest` listener in `src/modules/push-notification/index.ts`
  emits `data.screen = "attention"`, and the existing attention-fan-out
  test in `index.test.ts` is updated (not duplicated) to assert the new
  screen value plus the preserved attention title.
- `clients/mobile/src/navigation/routeNotificationResponse.ts` maps
  `screen=attention` to the AttentionScreen route, with coverage in
  `clients/mobile/src/__tests__/routeNotificationResponse.test.ts`.
- `pnpm test` (or the mobile test command) and the push-notification
  module's tests both pass cleanly; no other workflow-fan-out tests
  regress on the screen union change.

## Source / Intent

The just-completed web AttentionPanel task (`task-add-web-client-attention-panel-consuming-apiattent`,
commit `bc2c338b`) explicitly named "macOS and mobile attention surfaces"
plus the push deep-link extension as the remaining steps. The daily-digest
initiative landed the same seven-surface cadence (Telegram → CLI → daemon
HTTP → web → macOS → mobile → push) and is the worked precedent.
Operators tapping the attention push notification today land on the
daily-digest screen instead of an attention-shaped screen, and the mobile
client otherwise has no attention surface at all.

## Initiative

Attention seam fan-out — match the digest seam's seven-surface client
coverage so the on-demand attention rollup the daemon already serves is
reachable from every operator surface, including the mobile screen and a
deep-link target separate from the daily-digest screen.

## Acceptance Evidence

- Mobile test command output showing the new AttentionScreen reducer,
  navigation, and push deep-link tests passing.
- A screenshot or transcript of the mobile AttentionScreen showing both
  a populated-items state and the empty-state copy driven by the same
  daemon route.
- A captured emit of `workflow.attention.digest` showing the resulting
  push payload carrying `data.screen = "attention"` (e.g. via the
  `index.test.ts` assertion or a manual run trace).
- A short rendered-output sample (text body) from the AttentionScreen
  next to the equivalent `kota attention` CLI output proving body parity.
