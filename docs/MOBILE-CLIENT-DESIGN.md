# KOTA Mobile Client Design

This document records the technology choice, navigation structure, wireframes,
daemon API surface, auth/discovery flow, and approval interaction model for the
KOTA mobile client (`clients/mobile/`).

---

## Technology Decision

**Recommendation: React Native (Expo)**

Rationale:

- KOTA's codebase, web dashboard, and macOS client are already in TypeScript.
  React Native lets a single developer maintain the mobile client without adding
  a new language (Swift/Kotlin) to the project.
- The client is intentionally thin — all logic lives in the daemon. No complex
  platform-native capabilities (camera, Bluetooth, health) are needed, so
  cross-platform framwork overhead is minimal.
- Expo simplifies builds and over-the-air updates without requiring a full Xcode
  / Android Studio setup for routine changes.
- React Native's `EventSource` / `fetch` API maps cleanly onto the daemon's
  HTTP+SSE protocol with no platform-specific adapters required.
- The macOS client (`clients/macos/`) already demonstrates SwiftUI as the
  right choice for a menu bar app; mobile does not inherit that constraint.

Alternative considered: **SwiftUI (iOS-only)**. Rejected because it excludes
Android and requires a separate Swift codebase.

Target platforms: **iOS 16+**, **Android 12+** (API 31+).

Client lives at `clients/mobile/` following the pattern of `clients/macos/`.

---

## Navigation Structure

Top-level navigation uses a **bottom tab bar** with four tabs. Each tab has its
own stack navigator for drill-down screens.

```
Bottom Tab Bar
├── Status      — daemon health, active runs, quick pause/resume
├── Runs        — run history list → run detail → step detail
├── Approvals   — pending approval list → approval detail (approve/reject)
└── Tasks       — task queue overview (inbox/ready/doing/blocked counts)
```

Secondary screens reachable outside the tab bar:

- **Settings** — accessible from the Status tab header (gear icon)
  - Daemon URL or project directory path
  - Auth token entry
  - Notification preferences

### Screen Hierarchy

```
Status
├── DaemonStatusScreen        (root)
│   ├── active run items → RunDetailScreen
│   └── gear icon → SettingsScreen

Runs
├── RunListScreen             (root, filterable by workflow name)
└── RunDetailScreen           (steps list, cost, duration)

Approvals
├── ApprovalListScreen        (root, pending count badge on tab)
└── ApprovalDetailScreen      (full tool call detail, approve/reject)

Tasks
└── TaskQueueScreen           (root, counts by state, doing list)
```

---

## Wireframes

### 1. Status Screen

```
┌─────────────────────────────┐
│  KOTA          [⚙ Settings] │
├─────────────────────────────┤
│  ● Daemon: Running           │
│  Uptime: 4h 12m             │
│                             │
│  Active Runs (1)            │
│  ┌───────────────────────┐  │
│  │ builder  ◷ 12m 34s   │  │
│  │ Triggered by explorer │  │
│  └───────────────────────┘  │
│                             │
│  Queue: 0 pending           │
│                             │
│  [⏸ Pause Dispatch]         │
├─────────────────────────────┤
│ Status │ Runs │ ✅1 │ Tasks  │
└─────────────────────────────┘
```

### 2. Run List Screen

```
┌─────────────────────────────┐
│  Runs              [Filter▾]│
├─────────────────────────────┤
│  builder    ✓ success  2m   │
│  2026-04-09 14:02  $0.47    │
│  ─────────────────────────  │
│  builder    ✗ failed   8m   │
│  2026-04-09 11:17  $0.22    │
│  ─────────────────────────  │
│  explorer   ✓ success  1m   │
│  2026-04-09 11:15  $0.04    │
│  ─────────────────────────  │
│  [Load more]                │
├─────────────────────────────┤
│ Status │ Runs │ ✅1 │ Tasks  │
└─────────────────────────────┘
```

### 3. Run Detail Screen

```
┌─────────────────────────────┐
│  ← Run Detail               │
├─────────────────────────────┤
│  builder — success          │
│  Apr 9, 14:02 · 5m 12s      │
│  Cost: $0.47                │
│                             │
│  Steps                      │
│  ✓ inspect-ready-queue  0s  │
│  ✓ build           5m 12s   │
│    14× Bash  6× Read  3× Edit│
│  ✓ validate             1s  │
├─────────────────────────────┤
│ Status │ Runs │ ✅1 │ Tasks  │
└─────────────────────────────┘
```

### 4. Approval List Screen

```
┌─────────────────────────────┐
│  Approvals (1 pending)      │
├─────────────────────────────┤
│  ⚠ shell — dangerous        │
│  rm -rf /tmp/old-build      │
│  Requested 2m ago           │
│             [Approve][Reject]│
│  ─────────────────────────  │
│  (No more pending items)    │
├─────────────────────────────┤
│ Status │ Runs │ ✅1 │ Tasks  │
└─────────────────────────────┘
```

### 5. Approval Detail Screen

```
┌─────────────────────────────┐
│  ← Approval Detail          │
├─────────────────────────────┤
│  Tool: shell                │
│  Risk: dangerous            │
│  Requested: 2m ago          │
│                             │
│  Command:                   │
│  rm -rf /tmp/old-build      │
│                             │
│  Reason:                    │
│  cleanup script from build  │
│  step                       │
│                             │
│  Note (optional):           │
│  ┌───────────────────────┐  │
│  │                       │  │
│  └───────────────────────┘  │
│                             │
│  [    Reject    ][  Approve ]│
├─────────────────────────────┤
│ Status │ Runs │ ✅1 │ Tasks  │
└─────────────────────────────┘
```

---

## Daemon API Surface

All state comes from the daemon control API. The client never reads `.kota/`
files directly.

### Required Endpoints

| Endpoint | Usage |
|---|---|
| `GET /health` | Liveness check on connect; no auth required |
| `GET /status` | Daemon status, active runs, paused state (Status screen) |
| `GET /workflow/runs` | Run list with status, duration, cost (Runs screen) |
| `GET /workflow/runs/:id` | Run detail with per-step breakdown |
| `GET /approvals` | Pending approval list (Approvals screen) |
| `POST /approvals/:id/approve` | Approve with optional note |
| `POST /approvals/:id/reject` | Reject with optional reason |
| `GET /tasks` | Task queue counts and doing list (Tasks screen) |
| `POST /workflow/pause` | Pause dispatch from Status screen |
| `POST /workflow/resume` | Resume dispatch from Status screen |
| `GET /events` (SSE) | Live push updates — no polling required |

### SSE Event Subscriptions

The client opens one persistent SSE connection to `GET /events` and reacts to:

| Event | Client action |
|---|---|
| `workflow.started` | Add active run to Status screen |
| `workflow.completed` | Remove from active runs; refresh run list top item |
| `approval.changed` | Refresh approvals list; update tab badge count |
| `queue.changed` | Update queue depth on Status screen |
| `task.changed` | Update task counts on Tasks screen |

On reconnect, the client passes `?since=<last-event-timestamp>` to replay
missed events and resync state without a full poll.

### Polling Fallback

SSE is preferred. If SSE is unavailable (network proxy stripping chunked
responses), the client falls back to polling `GET /status` and `GET /approvals`
every 10 seconds. The fallback is detected by SSE connection timeout and
surfaced as a "Live updates unavailable" status indicator.

---

## Auth and Discovery Flow

### Discovery

The daemon writes its address and token to `.kota/daemon-control.json`:

```json
{
  "port": 49251,
  "pid": 12345,
  "startedAt": "2026-04-09T12:00:00.000Z",
  "token": "a3f8..."
}
```

A mobile app cannot read this file directly. Discovery proceeds in priority order:

1. **Manual URL + token** — operator enters `http://<host>:<port>` and token in
   Settings. This is the primary flow for remote access over a local network or
   VPN.

2. **QR code scan** (optional, v2) — the KOTA web dashboard or CLI renders a QR
   code encoding the daemon URL and a short-lived session token. The app scans
   it to auto-fill Settings without typing.

The token entered in Settings is stored in the OS secure keychain
(`Keychain` on iOS, `Keystore` on Android) and never in plain AsyncStorage.

### Authentication

Every request includes:

```
Authorization: Bearer <token>
```

The token matches the value in `daemon-control.json`. No login screen, no
OAuth — the token itself is the shared secret. The operator is responsible for
configuring network access (local Wi-Fi, Tailscale/VPN, or reverse proxy).

### Offline State

If `GET /health` fails:
- All screens show a "Daemon offline" banner.
- Data from the previous successful poll is displayed as stale (greyed out).
- SSE is torn down; the client retries `GET /health` every 15 seconds.
- When health returns 200, the client resumes SSE and refreshes all screens.

---

## Key Interaction: Reviewing and Resolving a Pending Approval

This is the most time-critical operator action from a phone.

**Notification entry point** (future work): a push notification can be
delivered when `approval.changed` fires. This requires an out-of-band push
gateway (not currently in the daemon API); for now, the operator must open the
app to see new approvals.

**In-app flow:**

1. Approvals tab badge shows count from `approval.changed` SSE events.
2. Operator taps Approvals tab → `ApprovalListScreen` lists pending items from
   `GET /approvals`, each showing: tool name, risk tier, input summary,
   age.
3. Tapping an item opens `ApprovalDetailScreen` with full input (scrollable),
   risk label, reason string, and an optional note field.
4. Operator taps **Approve** or **Reject**:
   - Approve → `POST /approvals/:id/approve` with `{ "note": "<optional>" }`
   - Reject → `POST /approvals/:id/reject` with `{ "reason": "<optional>" }`
5. On success, the item disappears from the list and the tab badge decrements.
   If the SSE stream is open, `approval.changed` arrives before the API
   response in most cases — the UI updates are idempotent either way.
6. On network error, a toast is shown and the item stays in the list for retry.

**Swipe-to-approve shortcut**: on the list screen, a swipe-right gesture on a
low-risk item calls approve immediately (with no note). A swipe-left calls
reject. This is a convenience shortcut; high-risk items (`dangerous`) require
opening the detail screen to confirm.

---

## Implementation Notes for Builder

- Client entry point: `clients/mobile/` with `package.json`, Expo config, and
  an `AGENTS.md`.
- The daemon client module (`src/daemonClient.ts`) should wrap `fetch` with the
  stored token and base URL; a thin `useSSE` hook drives live state.
- Navigation library: React Navigation v7 (standard Expo choice).
- State management: simple React Context + `useReducer`; no Redux needed for
  this scope.
- Do not add any server-side endpoints. The existing daemon API is sufficient.
- If a missing API capability is discovered during implementation, file a task
  to `tasks/inbox/` rather than patching the daemon from within the client PR.
- Secure token storage: `expo-secure-store` (wraps Keychain on iOS, Keystore on
  Android).
