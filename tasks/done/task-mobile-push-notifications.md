---
id: task-mobile-push-notifications
title: Add push notifications to the mobile client for pending approvals
status: done
priority: p2
area: client
summary: The KOTA mobile client has no push notification support, so operators only see new approvals when the app is open. Approvals are the most time-critical operator action; missing one blocks a running workflow. Adding Expo push notifications for approval.requested and approval.changed events closes the most important gap left after the initial mobile client build.
created_at: 2026-04-09T01:06:21Z
updated_at: 2026-04-09T01:06:21Z
---

## Problem

The mobile client connects to the daemon via SSE when the app is in the foreground, giving live approval badge counts and status updates. When the app is in the background or closed, there is no signal: the operator must open the app to discover that a workflow is waiting for approval.

This is the most time-critical gap in the mobile client. An approval waiting for a human decision blocks a running workflow. Operators who rely on the mobile client as their primary approval surface will miss approvals until they happen to open the app.

The KOTA mobile client design doc (`docs/MOBILE-CLIENT-DESIGN.md`) explicitly identifies push notifications as future work, requiring an out-of-band push gateway not present in the first build.

## Desired Outcome

- When the daemon emits `approval.requested`, a push notification is delivered to the operator's device even when the app is closed.
- Tapping the notification navigates directly to the Approvals tab (deep link).
- The notification body shows: workflow name, tool name, and risk level (e.g. "builder — git commit — moderate").
- Uses `expo-notifications` for iOS and Android support.
- Push token registration: the mobile client registers its Expo push token with the daemon via a new `POST /push-tokens` endpoint; the daemon stores it in `.kota/push-tokens.json`.
- The daemon delivers push notifications via the Expo Push API (`https://exp.host/--/expo-server/push`) when `approval.requested` fires.
- If the Expo Push API is unavailable or the token is stale, the daemon logs a warning but does not fail.
- Notification settings: operators can opt out in the Settings screen.

## Constraints

- Uses Expo's managed push infrastructure — no APN or FCM credentials required from the operator.
- Push token storage is local to the project's `.kota/` directory; no external database.
- The daemon sends notifications only when a push token is registered; if no token exists, behavior is unchanged from today.
- The Expo Push API call is a best-effort fire-and-forget (no retry loop); SSE remains the reliable real-time path when the app is open.
- Push token registration endpoint requires daemon Bearer auth.
- Document the new endpoint in `docs/DAEMON-API.md`.

## Done When

- `clients/mobile/` registers an Expo push token on startup and sends it to `POST /push-tokens` on the daemon.
- The daemon stores and rotates push tokens in `.kota/push-tokens.json`.
- When `approval.requested` fires, the daemon POSTs to the Expo Push API for each registered token.
- On iOS and Android: a push notification arrives when the app is backgrounded or closed, with workflow name and tool name in the body.
- Tapping the notification opens the Approvals tab.
- An opt-out toggle in Settings prevents future token registration from this device.
