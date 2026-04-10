# Mobile Client

React Native (Expo) mobile client for the KOTA daemon. Targets iOS 16+ and Android 12+ (API 31+).

- All state comes from the daemon control API — no `.kota/` file parsing.
- Authentication uses `Authorization: Bearer <token>` stored in the OS secure keychain via `expo-secure-store`.
- Navigation: bottom tab bar with five tabs (Status, Runs, Approvals, Tasks, Chat) using React Navigation v7.
- Live updates via SSE (`GET /events`); polling fallback if SSE is unavailable.
- Settings (daemon URL + token) are accessible from the Status tab header.
- QR setup: the Settings screen includes a "Scan QR Code" button that reads a QR code
  produced by `kota daemon qr` to auto-fill and save the daemon URL and token.

## Push Notification Deep Links

The daemon sends Expo push notifications when `approval.requested` fires
(`src/scheduler/push-tokens.ts`). The data payload includes a `screen` field
that controls where the app navigates when the user taps the notification.

| `screen` value | Navigates to | Extra fields |
|---|---|---|
| `"approvals"` | Approvals tab; `ApprovalDetail` if `approvalId` is present | `approvalId?: string` |
| _(absent)_ | No navigation — app opens to current state | — |

Notifications sent before this protocol existed have no `screen` field and are
treated as open-app-only (backward compatible).

To add a new notification destination: emit the appropriate `screen` value from
the daemon, add the corresponding navigation case in `navigateToApproval` (or a
new helper), and document the new row in this table.

## Adding Features

- Do not add server-side endpoints. The existing daemon API is sufficient.
- If a missing API capability is discovered, file a task to `tasks/inbox/` rather than patching the daemon.
- Keep screens thin: fetch from `DaemonContext` or call `daemonClient` directly; no business logic in screens.
