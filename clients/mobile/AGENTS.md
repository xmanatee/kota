# Mobile Client

React Native (Expo) mobile client for the KOTA daemon. Targets iOS 16+ and Android 12+ (API 31+).

- All state comes from the daemon control API — no `.kota/` file parsing.
- Authentication uses `Authorization: Bearer <token>` stored in the OS secure keychain via `expo-secure-store`.
- Navigation: bottom tab bar with four tabs (Status, Runs, Approvals, Tasks) using React Navigation v7.
- Live updates via SSE (`GET /events`); polling fallback if SSE is unavailable.
- Settings (daemon URL + token) are accessible from the Status tab header.

## Structure

- `App.tsx` — entry point, providers, navigation root
- `src/types.ts` — shared API response types
- `src/daemonClient.ts` — typed HTTP client wrapping `fetch`
- `src/hooks/useSSE.ts` — SSE hook driving live state
- `src/context/DaemonContext.tsx` — React Context + useReducer state tree
- `src/navigation/index.tsx` — tab and stack navigator definitions
- `src/screens/` — one file per screen

## Adding Features

- Do not add server-side endpoints. The existing daemon API is sufficient.
- If a missing API capability is discovered, file a task to `tasks/inbox/` rather than patching the daemon.
- Keep screens thin: fetch from `DaemonContext` or call `daemonClient` directly; no business logic in screens.
