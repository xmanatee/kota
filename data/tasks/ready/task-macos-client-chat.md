---
id: task-macos-client-chat
title: Add chat panel to macOS menu bar client
status: ready
priority: p2
area: client
summary: The macOS menu bar client shows sessions from GET /sessions but cannot send messages. Add a chat popover or panel that mirrors the mobile chat experience using POST /sessions/:id/chat.
created_at: 2026-04-10T06:50:00Z
updated_at: 2026-04-10T06:50:00Z
---

## Problem

The mobile client received a full chat tab in the most recent cycle: users can create daemon sessions, send messages, and see streamed responses. The macOS menu bar client shows the active sessions list (`SessionsView.swift`) but has no way to interact with them — it is read-only. This makes the desktop experience significantly weaker than mobile for interactive daemon sessions.

## Desired Outcome

The macOS menu bar client allows the operator to:
1. Create a new daemon session (POST /sessions).
2. Select an active session from the sessions list.
3. Open a chat view (sheet or secondary popover) for the selected session.
4. Send messages via POST /sessions/:id/chat and display streamed SSE responses.
5. End a session via DELETE /sessions/:id.

The implementation should follow the same daemon API surface used by the mobile client. It does not need to be a separate window — a sheet or expanded panel within the menu bar popover is fine.

## Constraints

- Do not add Swift Package dependencies without strong justification.
- All state comes from the daemon API. No direct `.kota/` file access.
- SSE streaming from POST /sessions/:id/chat should be handled using URLSession data tasks with incremental response reading.
- Keep `AppState.swift` and `DaemonClient.swift` as the state and API boundaries — add methods there rather than embedding network calls in views.
- Update `clients/macos/AGENTS.md` with new files and their roles.

## Done When

- A session can be selected from SessionsView and a chat interface opens.
- Messages can be sent and streamed responses appear in real time.
- The session can be ended from the chat view.
- The macOS client compiles without errors (`swift build` or Xcode build passes).
