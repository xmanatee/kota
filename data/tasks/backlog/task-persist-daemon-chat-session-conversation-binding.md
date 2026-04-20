---
id: task-persist-daemon-chat-session-conversation-binding
title: Persist daemon chat session → conversation binding so clients can wake after daemon restart
status: backlog
priority: p2
area: daemon
summary: Daemon-owned chat sessions in DaemonChatPool hold AgentSession plus ProxyTransport in process memory without binding the session id to the persisted conversation id; a daemon crash abandons the session with no client-facing wake path. Thread conversationId through the daemon makeAgent factory and persist the session→conversationId binding so clients can resume.
created_at: 2026-04-20T01:45:45.000Z
updated_at: 2026-04-20T01:45:45.000Z
---

## Problem

`DaemonChatPool` (`src/core/daemon/daemon-control-chat.ts`) creates
`AgentSession` instances in daemon memory via the `makeAgent` factory
installed in `Daemon.constructor`
(`src/core/daemon/daemon.ts`). That factory does not pass
`resumeConversation`, so daemon-owned sessions never bind the
`session_id` returned to the client to a persisted `conversationId` in
`ConversationHistory`. When the daemon crashes mid-turn:

- The `AgentSession` and its in-flight turn are lost.
- Messages that were already saved by
  `ConversationHistory.save()` survive, but there is no way for the
  client holding `session_id` to reconnect to the same conversation —
  the daemon has no session→conversation mapping.
- `POST /sessions` today does not accept a `resumeConversation` /
  `conversation_id` parameter, so the client cannot ask the daemon to
  wake onto an existing conversation either.

The recoverability audit in `src/core/daemon/AGENTS.md` records this
as a live gap rather than a deliberate loss.

## Desired Outcome

- `POST /sessions` accepts an optional conversation id on creation, and
  the daemon threads it into `makeAgent` so the new `AgentSession`
  resumes from the persisted history.
- The daemon persists `session_id → conversationId` binding in an
  append-only form so the mapping survives a daemon restart. A new
  daemon boot re-exposes the binding to clients so `POST /sessions`
  with the same `session_id` (or with the `conversation_id`) returns a
  live session seeded from the saved history.
- Clients that reconnect after a daemon crash observe a documented
  wake contract rather than an opaque 404.
- The recoverability section of `src/core/daemon/AGENTS.md` is updated
  to move daemon-owned chat sessions out of the "gaps" list.

## Constraints

- Do not add a second event store. Reuse `ConversationHistory` for
  messages and land the session-binding persistence next to the chat
  pool (a small JSON file under `.kota/` is fine) — not a parallel
  database.
- Respect the daemon/core boundary: the wake path lives in the daemon
  core, not a module.
- No test-only production flag. The wake path is exercised by the
  normal `POST /sessions` flow.
- Serve-registered sessions are out of scope for this task; see
  `task-reregister-serve-sessions-after-daemon-restart`.
- The binding must survive a real process restart; a purely in-memory
  cache does not close the gap.

## Done When

- `POST /sessions` accepts a conversation id and the daemon-owned
  `AgentSession` resumes from persisted history.
- Session→conversation binding is persisted and rehydrated on daemon
  start.
- A focused test simulates a daemon restart between turns and asserts
  the client can wake onto the same conversation through the binding.
- `src/core/daemon/AGENTS.md` recoverability section reflects the
  closed gap.
