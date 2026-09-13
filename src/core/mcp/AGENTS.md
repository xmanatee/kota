# MCP

This directory contains the MCP client and manager used by the session loop
to connect KOTA as a client to external MCP servers and merge their tools
into the runtime tool list.

- Keep protocol boundaries clean and host-neutral.
- The client side is a session-loop runtime primitive and stays in core.
- The server side — exposing KOTA tools over MCP stdio — lives in the
  `mcp-server` module. Do not re-import server, prompt, or resource helpers
  back into core.
- Keep MCP client code split by protocol concern: public client orchestration,
  JSON-RPC protocol types, transport/runtime layers, OAuth/protected-resource
  handling, and feature decoders should live in focused sibling files rather
  than re-forming a monolithic client.
- The manager consumes the client through its narrow injected port. Keep
  server selection, routing, refresh, whole-catalog cache coordination, task
  resume, and multi-server composition in manager code; keep framing,
  decoding, pagination, OAuth, and transport failures behind the client port.
- Manager tests use typed client-port fakes and never boot protocol peers.
  Embedded peers, HTTP recorders, and wire-shape matrices belong to the client
  protocol portfolio.
- JSON-RPC, HTTP/SSE, OAuth, and feature-decoder files are approved external
  boundary files for strict type ratchet purposes; keep raw `unknown` use at
  those decode seams and return typed results to the rest of core.
- Exact MCP methods, capability flags, and payload shapes belong in source
  and protocol tests. Do not maintain a parallel catalog in `docs/`.
- Publish client terminal diagnostics through `McpClientBase.writeDiagnostic` so
  configured credentials are redacted from the complete message before rendering.
  Both diagnostic and stderr publication use the common terminal-renderer control
  sanitizer; peer text and labels must never reach a provider or stream directly.
  Protocol decoders return data; the client owns diagnostic publication.
- Route locally assembled lifecycle and decoding errors through
  `McpClientBase.diagnosticError`. Typed request-error constructors redact the
  assembled message and public metadata with the client's credential set.
  Result and retry decoders use `decodeWithRedaction` at the client boundary;
  successful values are never redacted in place. Keep peer identity and retry
  challenges unchanged in protocol state; sanitized error fields are diagnostic
  projections.
- Complete catalog traversal shares client-operation budgets and cancellation.
  Account for cursors and metadata as well as entries before retaining pages;
  per-response transport limits alone do not bound a catalog. Publish derived
  tool-header settings only after the complete traversal succeeds.
