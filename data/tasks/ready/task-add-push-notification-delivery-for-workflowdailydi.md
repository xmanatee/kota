---
id: task-add-push-notification-delivery-for-workflowdailydi
title: Add push-notification delivery for workflow.daily.digest so mobile devices wake up on the cadence
status: ready
priority: p2
area: modules
summary: Have the push-notification module subscribe to workflow.daily.digest (and workflow.attention.digest) so that registered Expo tokens receive a wake-up push when the cadence digest fires; deep-link the tap target to the mobile DigestScreen so the operator surfaces stay symmetric with telegram/slack/email/webhook channels.
created_at: 2026-04-26T06:13:29.799Z
updated_at: 2026-04-26T06:13:29.799Z
---

## Problem

The `daily-digest` workflow that landed 2026-04-26 (commit `48d7eeea`) emits
`workflow.daily.digest` at the 08:00 cadence, and `attention-digest` emits
`workflow.attention.digest` when something needs operator attention. Today
those two events are forwarded to operators by `telegram`, `slack`, `email`,
and `webhook` channel modules — every one of those modules lists both events
in its `NOTIFICATION_EVENTS` array and renders the payload's `text` body.

The mobile client just gained a `DigestScreen` (`clients/mobile/src/screens/
DigestScreen.tsx`, commit `7cbb403a`) that pulls the on-demand digest from
`/api/digest`. But the cadence path stops at the daemon: the
`push-notification` module only subscribes to `approval.requested` (see
`src/modules/push-notification/index.ts`). When the 08:00 cadence fires, no
wake-up push goes to registered Expo tokens. A mobile operator only learns
the daily rollup exists by manually opening the app and pulling on-demand
— exactly the gap that the chat-side `/digest` and the cadence-side
notification subscriptions on telegram/slack/email/webhook were built to
close.

The asymmetry is visible: every other channel module that ships in KOTA
forwards both digest events; the push-notification module does not. The
mobile DigestScreen surface exists; the wake-up signal pointing at it does
not.

## Desired Outcome

When `workflow.daily.digest` is emitted, every registered Expo push token
receives one push notification with a clear cadence-digest title (e.g.
"KOTA daily digest") and a short body derived from the rendered digest
text. Tapping that notification opens the mobile DigestScreen so the
operator lands directly on the rollup. `workflow.attention.digest` does
the same, with a title that reflects its different posture (attention
required, not routine cadence).

Delivery posture matches the existing approval push: fire-and-forget,
SSE remains the authoritative real-time path, no retry queue, Expo HTTP
errors logged through `ctx.log.warn(...)` and dropped. Quiet-hours
suppression continues to live where it already lives — the runtime
already gates `workflow.daily.digest` and `workflow.attention.digest`
through the same notification gate the chat channels see, so the push
module receives the event only when it is meant to be delivered.

The mobile client honors a new `data.screen === "digest"` payload field
in the notification-response listener and navigates to the DigestScreen
on tap, parallel to the existing `screen: "approvals"` path in
`clients/mobile/src/navigation/index.tsx`.

## Constraints

- One mechanism. Extend the existing `push-notification` module — do not
  introduce a parallel "digest-push" module or a second event-subscription
  surface. The `onLoad`/`onUnload` hook pair already in `index.ts` is the
  right shape; add the new subscriptions there and unsubscribe in
  `onUnload` alongside the approval subscription.
- Reuse `sendPushNotifications`-shaped delivery (Expo Push API
  fire-and-forget, no `notification.postWithRetry`, no retry queue).
  Either generalize `sendPushNotifications` to accept a typed payload
  variant or add a sibling `sendDigestPushNotifications` next to it; pick
  whichever keeps `send.ts` cohesive without two divergent retry stories.
  The module's "Delivery Posture" contract in
  `src/modules/push-notification/AGENTS.md` must continue to hold for the
  new path verbatim.
- The Expo notification body is short — push surfaces truncate. Use a
  fixed cadence title plus a small leading slice of the rendered digest
  text (or the digest's first summary line); do not stuff the entire
  multi-category rollup into the body. The DigestScreen renders the full
  body; the push is a wake-up hint.
- The push payload's `data` field carries `screen: "digest"`. Do not
  embed the digest body in `data` — the mobile client refetches via the
  on-demand `/api/digest` route on focus. This keeps push payloads under
  Expo's 4KB limit and keeps the digest body in one source of truth.
- The mobile client's notification-response listener (already at
  `clients/mobile/src/navigation/index.tsx:181`) handles
  `screen === "digest"` by navigating to the DigestScreen tab/stack.
  Mirror the existing `screen === "approvals"` branch — do not introduce
  a second listener or a different routing surface.
- Per the no-cost-bias-in-autonomy contract, the push payload is
  operator-facing only. The module must not log, persist, or otherwise
  expose digest text to autonomy agents in any prompt path.
- No protocol or wire-shape change to the existing `POST /push-tokens`
  registration route. The mobile client's existing `registerPushToken`
  call continues to work unchanged — only what the daemon-side module
  forwards expands.
- `workflow.daily.digest` and `workflow.attention.digest` may both fire
  during the same window. Each event produces one push fan-out; do not
  collapse, debounce, or queue them inside this module. Quiet-hours
  batching is already handled upstream by the runtime's notification
  gate.

## Done When

- `src/modules/push-notification/index.ts` subscribes to both
  `workflow.daily.digest` and `workflow.attention.digest` in `onLoad`,
  unsubscribes in `onUnload`, and fans each event out to the registered
  Expo tokens with a payload of shape
  `{ title, body, data: { screen: "digest" } }`.
- `src/modules/push-notification/send.ts` exposes a typed digest-push
  delivery path (either a parameterized `sendPushNotifications` or a
  sibling `sendDigestPushNotifications`) that preserves the
  fire-and-forget, no-retry, log-and-drop posture documented in the
  module's `AGENTS.md`.
- `clients/mobile/src/navigation/index.tsx` handles
  `screen === "digest"` in the existing notification-response listener
  and navigates to `DigestScreen`, mirroring the approvals branch.
- A focused unit test in `src/modules/push-notification/` asserts that
  emitting `workflow.daily.digest` on the bus produces an Expo Push API
  call to every registered token with the expected payload shape, and
  that emitting `workflow.attention.digest` produces a similarly-shaped
  call with its distinct title. The existing approval-push test stays
  green.
- A focused unit test in `clients/mobile/src/__tests__/` asserts that a
  notification-response containing `data.screen === "digest"` triggers
  navigation to the DigestScreen route.
- `src/modules/push-notification/AGENTS.md` documents the digest-event
  subscription alongside the existing approval subscription, including
  the `data.screen === "digest"` deep-link contract and the
  no-retry/operator-facing-only posture.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

The `daily-digest` workflow shipped 2026-04-26 (commit `48d7eeea`) and
the mobile `DigestScreen` shipped same-day (commit `7cbb403a`). The
recently-landed cluster — Telegram `/digest`, daemon `/api/digest`,
`kota digest` CLI, web `DigestPanel`, macOS `DigestView`, mobile
`DigestScreen` — gives every operator surface a *pull* path. The
*push* path on chat/email/webhook surfaces (telegram/slack/email/
webhook) already exists through their `workflow.daily.digest`
subscriptions. The mobile push surface is the last remaining channel
module that does not subscribe to the cadence event. This continues
the operator-observability initiative the owner has been pushing on:
operators should not have to scrape `.kota/runs/`, and they should
not have to manually open the mobile app at 08:00 to know the digest
is ready.

## Initiative

Operator observability for autonomous KOTA operation: every
operator-facing surface (CLI, chat, email, webhook, mobile, macOS,
web) should answer "what did KOTA accomplish overnight" and "what
needs my attention right now" on its native terms, including
proactive wake-up where the surface supports it. Push-notification
delivery for the cadence digest closes the wake-up gap on the mobile
surface that the just-landed DigestScreen depends on.

## Acceptance Evidence

- A live-run artifact under `.kota/runs/<run-id>/` that captures (a)
  the `workflow.daily.digest` event payload, (b) the resulting Expo
  Push API request body for at least one registered token, and (c)
  the mobile client's notification-response navigation transcript
  (test output or RN Testing Library trace) showing the DigestScreen
  tab activated for `screen === "digest"`.
- Co-located unit tests in `src/modules/push-notification/` and
  `clients/mobile/src/__tests__/` exercise both the daemon-side
  fan-out and the mobile-side deep-link path, and pass on
  `pnpm test`.
- Confirmation that `workflow.attention.digest` emissions produce a
  push with the attention-posture title (recorded in the run
  artifact), and that the existing `approval.requested` push path is
  unchanged (existing test still green).
