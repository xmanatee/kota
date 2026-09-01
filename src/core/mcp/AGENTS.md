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
