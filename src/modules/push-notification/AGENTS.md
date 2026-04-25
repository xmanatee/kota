# Push-Notification Module

Owns the entire Expo-push delivery surface for KOTA: the
`<projectDir>/.kota/push-tokens.json` store, the `POST /push-tokens`
daemon-control registration route, the Expo Push API HTTP call, and the
`approval.requested` bus subscription that drives delivery.

The module contributes the route through `KotaModule.controlRoutes`
(`control` capability scope) and subscribes to the bus in `onLoad`,
unsubscribing in `onUnload`. The wire contract — JSON body
`{ token, deviceId }`, `400 { error: "Invalid JSON body" }` on parse
failure, `400 { error: "token and deviceId are required" }` on missing
fields, `200 { ok: true }` on success — matches what the mobile client's
`DaemonControlClient.registerPushToken` expects.

## Recoverability

`<projectDir>/.kota/push-tokens.json` is rewritten on every registration.
Tokens survive daemon crashes; the in-flight Expo Push API call does not
(by design — see below).

## Delivery Posture

Expo deliveries are intentionally fire-and-forget. SSE is the
authoritative real-time path for clients with the app open; a missed push
is recovered by SSE on next reconnect. We deliberately do not reuse the
`notification` module's `postWithRetry` helper — retrying an Expo failure
would build a queue with no consumer, extend the
`approval.requested → push` path past the best-effort wake-up hint
contract, and grow unbounded if a device was uninstalled. Expo HTTP
errors are surfaced through `ctx.log.warn(...)` and dropped.
