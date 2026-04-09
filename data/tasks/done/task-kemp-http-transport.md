---
id: task-kemp-http-transport
title: Add HTTP transport for KEMP foreign modules
status: done
priority: p3
area: runtime
summary: Add HTTP transport to KEMP so foreign modules can connect to already-running HTTP servers instead of requiring a subprocess per module.
created_at: 2026-03-30T19:10:00Z
updated_at: 2026-03-31T07:20:00Z
---

## Problem

KEMP currently supports only stdio transport, which spawns a subprocess per foreign module. This works well for scripts but makes it impossible to connect to an already-running service (a Python FastAPI server, a Go binary, a remote tool host) without wrapping it in a subprocess shim. Operators who want to integrate with external tools or share a long-lived service process across KOTA instances have no supported path.

## Desired Outcome

KEMP gains an HTTP transport option. A foreign module configured with `"transport": "http"` connects to a running HTTP server that speaks the KEMP protocol over POST requests (or WebSocket/SSE for streaming). KOTA sends `init`, `invoke`, and `shutdown` messages as HTTP requests; the server replies with `manifest`, `result`, and `shutdown_ack` responses. The existing protocol envelope and message types remain unchanged — only the transport layer is new. `docs/FOREIGN-MODULES.md` is updated to document the HTTP transport and include a minimal example server.

## Constraints

- Protocol message types and envelope format must stay identical to the stdio transport; only the framing mechanism changes.
- The HTTP transport implementation should live alongside `src/foreign-module-stdio.ts` following the same adapter pattern.
- An HTTP module that cannot be reached at startup should be skipped with a warning, consistent with the existing stdio behavior for missing commands.
- No new runtime dependencies should be required for the client side (Node's built-in `fetch` is sufficient).

## Done When

- `"transport": "http"` is accepted in `foreignModules` config with a `url` field pointing to the server.
- A minimal example HTTP server (Python or Node) is added under `examples/modules/`.
- `docs/FOREIGN-MODULES.md` documents the HTTP transport config and the server contract.
- The existing foreign-module integration tests still pass; at least one test covers the HTTP transport path (can be skipped if no example server is available, following the Python demo pattern).
