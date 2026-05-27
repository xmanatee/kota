---
id: task-add-acp-session-discovery-and-resume-support
title: Add ACP session discovery and resume support
status: done
priority: p2
area: modules
summary: ACP now has stable session list/resume lifecycle methods; KOTA's ACP adapter should expose them through daemon-owned sessions and persisted chat bindings instead of leaving clients to re-create state.
created_at: 2026-05-27T05:07:17.317Z
updated_at: 2026-05-27T05:20:22Z
---

## Problem

KOTA now has a module-owned Agent Client Protocol adapter, but the current
adapter only covers the first useful turn lifecycle: `initialize`,
`session/new`, `session/prompt`, cancellation, and `session/close`. The ACP
docs now expose stable session discovery and reconnect behavior through
`session/list` and `session/resume`, and KOTA already has daemon-owned chat
sessions plus a persisted `sessionId -> conversationId` wake path.

Leaving these ACP methods unsupported means an ACP client cannot show KOTA's
known sessions or reconnect to a bound daemon chat session after the ACP
subprocess/client connection changes. That pushes clients toward bespoke KOTA
state handling even though the daemon already owns the canonical session
lifecycle.

## Desired Outcome

KOTA's ACP adapter supports session discovery and resume by mapping ACP methods
onto the existing daemon control session surface. A compatible ACP client can
initialize, create a session, list known sessions for a project root, resume a
known session without replaying history, and continue prompting through the same
daemon-owned session/conversation binding.

`session/load` remains explicitly unsupported unless the implementation also
replays conversation history through `session/update` notifications. Capability
advertising stays honest.

## Constraints

- Keep ACP behavior inside `src/modules/agent-client-protocol/`. Add only
  genuinely shared daemon-control support if the adapter needs a typed route to
  list or wake persisted chat bindings; do not read `.kota/` files directly
  from the ACP module.
- Preserve the daemon as the source of truth for live and resumable sessions.
  The ACP adapter may cache connection-local active ids, but not own a parallel
  session store.
- Decode ACP payloads at the adapter boundary and fail with typed JSON-RPC
  errors for malformed params, unsupported MCP handoff, unknown project roots,
  unknown sessions, or already-live resume targets.
- Advertise `sessionCapabilities.list` and `sessionCapabilities.resume` only
  after the corresponding methods work. Keep `loadSession: false` until full
  history replay is implemented.
- Keep stdio clean: stdout is protocol-only, diagnostics go to stderr.

## Done When

- `initialize` advertises the implemented ACP lifecycle capabilities
  accurately.
- `session/list` returns KOTA daemon-owned sessions for the requested absolute
  `cwd`, including enough metadata for ACP clients to display and select a
  session.
- `session/resume` validates `cwd`, `sessionId`, and empty/unsupported
  `mcpServers`, wakes or attaches to the daemon-owned session through existing
  daemon session APIs, records the resumed id in the adapter connection, and
  does not replay prior conversation history.
- Unsupported lifecycle methods such as `session/load` still produce typed ACP
  protocol errors with no side effects.
- Focused tests cover capability advertising, list filtering, resume success,
  wake-after-adapter-restart behavior, already-live/unknown-session failures,
  unsupported MCP handoff during resume, and stdout/stderr separation.

## Source / Intent

Explorer run `2026-05-27T05-05-31-742Z-explorer-v7z6mf` refreshed the new
watchlist entry for Agent Client Protocol while the actionable queue was empty.
The strategic blocked alternatives all require operator-captured artifacts, so
this nonduplicative ACP interoperability slice is the right ready task.

Relevant local state:

- `data/tasks/done/task-expose-kota-sessions-through-an-agent-client-proto.md`
  completed the initial ACP adapter and explicitly left session lists, MCP
  handoff, auth, filesystem proxying, and terminal requests as scoped future
  capability decisions.
- `src/modules/agent-client-protocol/server.ts` currently handles
  `session/new`, `session/prompt`, `session/cancel`, and `session/close`, but
  not `session/list` or `session/resume`.
- `src/core/daemon/daemon-chat-bindings.ts` and the daemon `POST /sessions`
  wake path already persist and restore daemon chat session bindings.

Primary sources:

- https://agentclientprotocol.com/get-started/architecture - ACP architecture
  defines JSON-RPC subprocess setup, concurrent sessions, real-time
  notifications, permission requests, and MCP handoff.
- https://agentclientprotocol.com/protocol/overview - ACP's baseline flow
  includes initialization, session setup, prompt turns, updates, and
  cancellation.
- https://agentclientprotocol.com/protocol/session-list - ACP defines
  `session/list` so clients can discover known sessions and receive metadata
  updates.
- https://agentclientprotocol.com/protocol/session-setup - ACP defines
  `session/resume` as reconnecting to an existing session without replaying
  prior messages.

## Initiative

Agent/client interoperability through module-owned protocol adapters.

## Acceptance Evidence

- `pnpm test src/modules/agent-client-protocol/index.test.ts`
- Focused daemon-control/session tests if a daemon route is added or changed.
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/agent-client-protocol src/core/daemon`
- A protocol transcript under `.kota/runs/<run-id>/` showing initialize,
  `session/new`, `session/list`, ACP adapter restart/reconnect,
  `session/resume`, and a follow-up `session/prompt` against the resumed
  session.
