# MCP

This directory contains the MCP client and manager used by the session loop
to connect KOTA as a client to external MCP servers and merge their tools
into the runtime tool list.

- Keep protocol boundaries clean and host-neutral.
- The client side is a session-loop runtime primitive and stays in core.
- The server side — exposing KOTA tools over MCP stdio — lives in the
  `mcp-server` module. Do not re-import server, prompt, or resource helpers
  back into core.
- Exact MCP methods, capability flags, and payload shapes belong in source
  and protocol tests. Do not maintain a parallel catalog in `docs/`.
