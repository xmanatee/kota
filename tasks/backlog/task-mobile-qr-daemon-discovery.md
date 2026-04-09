---
id: task-mobile-qr-daemon-discovery
title: Add QR code daemon discovery to the mobile client
status: backlog
priority: p3
area: client
summary: The mobile client requires operators to manually type the daemon URL and token. The design doc identified QR code scan as the preferred v2 discovery flow — the web dashboard or CLI renders a QR code encoding the URL and a short-lived session token, and the app scans it to auto-fill Settings without typing.
created_at: 2026-04-09T01:06:21Z
updated_at: 2026-04-09T01:06:21Z
---

## Problem

Mobile client onboarding requires the operator to manually enter the daemon URL (including the dynamic ephemeral port) and the 64-hex-character auth token. This is error-prone on a phone keyboard and creates friction for every new device setup. The design document (`docs/MOBILE-CLIENT-DESIGN.md`) explicitly plans a QR scan flow as the v2 discovery mechanism.

## Desired Outcome

- `kota daemon qr` CLI command (or `kota status --qr`) renders a QR code in the terminal encoding a JSON payload with: `url`, `token`, and `expiry` (5-minute TTL short-lived session token or the main token if no rotation is supported).
- The mobile Settings screen gains a "Scan QR Code" button that activates the camera, scans the QR code, auto-fills the URL and token fields, and saves.
- After scan, the operator is taken directly to the Status tab.

## Constraints

- QR rendering in terminal: use `qrcode-terminal` (Node, zero native deps) or a similar lightweight package.
- Mobile camera: use `expo-camera` or `expo-barcode-scanner` (already supported by Expo managed workflow).
- The QR payload should be small: `{"url":"http://...","token":"..."}`. No additional metadata needed.
- The encoded token should be the main daemon token (no short-lived token rotation is required for v1 of this feature).
- Fallback: manual URL/token entry remains the primary path; QR is additive.
- Document the new CLI command in docs.

## Done When

- `kota daemon qr` prints a scannable QR code to the terminal that encodes the daemon URL and token.
- The mobile Settings screen includes a "Scan QR" button that opens the camera and auto-fills credentials on successful scan.
- Manual entry still works unchanged.
