---
id: task-mobile-chat-tab
title: Add interactive chat tab to mobile client using daemon session API
status: done
priority: p3
area: client
summary: The mobile client has no way to initiate or participate in an interactive KOTA session. Once the daemon exposes a /chat API (task-daemon-interactive-chat-api), a Chat tab on mobile would let operators give the agent ad-hoc instructions without switching to a terminal or the web UI.
created_at: 2026-04-10T05:20:00Z
updated_at: 2026-04-10T06:22:05Z
---

## Problem

The mobile client (Status, Runs, Approvals, Tasks tabs) is read-oriented —
operators can observe daemon state and handle approvals, but cannot give the
agent instructions directly from mobile. If a builder run needs quick guidance
or an operator wants to kick off a one-off query, they must open a terminal or
the web UI.

The daemon interactive chat API (`task-daemon-interactive-chat-api`) adds
`POST /sessions`, `POST /sessions/:id/chat`, and `DELETE /sessions/:id` to the
daemon control API. Once those endpoints exist, the mobile client can host a
chat interface with no backend changes.

## Desired Outcome

A fifth tab "Chat" appears in the bottom tab bar between Tasks and (implicitly)
the existing tabs. The tab:

- Shows a list of active daemon sessions (from `GET /sessions` filtered to
  `source: "daemon"`), with a "New Session" button.
- Opening a session navigates to `ChatDetailScreen` which shows the message
  history and a text input.
- Sending a message calls `POST /sessions/:id/chat` and renders the SSE stream
  as the agent types, similar to how `RunDetailScreen` handles streaming events.
- Closing a session calls `DELETE /sessions/:id`.

New files: `src/screens/ChatListScreen.tsx` and `src/screens/ChatDetailScreen.tsx`.
`DaemonContext` gains session management actions (create, close) and `daemonClient`
gains `createSession()`, `sendMessage()` (SSE), and `deleteSession()`.

## Constraints

- Only active when the daemon connection is healthy — grey out the Chat tab and
  show an "offline" message when the daemon is unreachable.
- Do not add a new bottom tab if it crowds the bar on small phones; use a modal
  or slide-over pattern if five tabs is too wide.
- SSE streaming on React Native uses the existing `useSSE` hook pattern or a
  `fetch`-based reader — no new native modules.
- `clients/mobile/AGENTS.md` updated to mention the new screens.

## Done When

- A Chat tab (or equivalent entry point) lets the operator start a daemon session from mobile.
- Messages stream in real time from the agent via SSE.
- Sessions can be closed from the UI.
- `pnpm run typecheck` in `clients/mobile/` passes.
- `clients/mobile/AGENTS.md` lists the new screens.
