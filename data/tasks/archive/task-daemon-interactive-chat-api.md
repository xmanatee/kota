---
status: done
---

# Add interactive chat endpoint to daemon control API

## Problem

The architecture vision in `docs/DAEMON-CLIENTS.md` describes clients (native
apps, mobile apps, web apps) connecting to the daemon as clients rather than
starting their own KOTA runtimes. The daemon currently provides workflow status,
approvals, knowledge, memory, and history — but no interactive session endpoint.

Interactive chat sessions exist in `kota serve` mode, which runs a separate
HTTP server with `/api/chat` and `/api/sessions`. The daemon's control API does
not expose these routes. Clients that connect to the daemon via
`daemon-control.json` (the macOS app, mobile app, external tools) have no way
to initiate or participate in an agent conversation.

`kota serve` clients register their sessions with the daemon via
`POST /sessions/register`, but that is one-way registration, not the same as
opening a chat.

## Desired Outcome

The daemon control API gains:

- `POST /sessions` — create a new interactive session; returns `{ session_id }`.
- `POST /sessions/:id/chat` — send a message to an existing session; streams
  the agent response as SSE (`text/event-stream`). Follows the same event
  shape as `kota serve`'s `/api/chat` (events: `session`, `text`, `tool_use`,
  `tool_result`, `done`, `error`).
- `DELETE /sessions/:id` — close a session (already exists but now also
  applies to daemon-owned sessions).

The daemon initializes a `SessionPool` backed by its own module context and
model config. Sessions are swept after an idle TTL (configurable, default 5
minutes). The new endpoints require the `Authorization` Bearer token like all
other daemon control routes.

`docs/DAEMON-API.md` is updated with the new endpoints.

## Constraints

- Session pool is daemon-owned, not shared with any `kota serve` instance.
- Daemon-owned sessions use `bypassPermissions` mode and the daemon's tool scope.
- Daemon-owned sessions appear in `GET /sessions` alongside registered `kota serve` sessions, distinguished by a `source: "daemon"` field vs `source: "serve"`.
- No new `kota serve` changes needed.
- Existing `POST /sessions/register` (for `kota serve` self-registration) is unchanged.

## Done When

- `POST /sessions` creates a daemon-owned session and returns `{ session_id }`.
- `POST /sessions/:id/chat` streams a response for a valid session.
- `GET /sessions` lists daemon-owned sessions with `source: "daemon"`.
- `docs/DAEMON-API.md` documents the new endpoints.
- `src/server/AGENTS.md` (or relevant server docs) mentions daemon session pool.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm test` pass.
