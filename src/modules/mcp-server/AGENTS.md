# MCP Server Module

This directory owns the `mcp-server` repo module — exposes KOTA tools via
the Model Context Protocol over stdio.

- Registers the `kota mcp-server` CLI command. The action handler routes
  through `ctx.client.mcpServer.start(opts)`. The local handler in
  `mcp-server-operations.ts` re-loads the full module set (lifecycle mode
  `"runtime"`) before instantiating `McpServer` so every contributed tool
  is available.
  The daemon-side handler returns `{ ok: false, reason: "daemon_required" }`
  because the daemon cannot start a stdio MCP server in another process;
  the CLI maps that to a "stop the daemon first" hint.
- Owns the `McpServer` class plus its prompt and resource helpers and the
  co-located server tests.
- Treat MCP as a transport over KOTA capabilities, not a second capability
  registry. Tools, resources, prompts, sampling, roots, and elicitation are
  adapters around existing runtime contracts.
- The MCP client and manager stay in `src/core/mcp/` because the session
  loop and tool runner consume them directly. Do not import from there here
  unless a new genuine runtime primitive appears.
- Exact MCP method names, resource identifiers, prompt names, capability
  flags, and payload shapes belong in source and protocol tests, not in
  durable prose.
- This module owns the `KotaTool` ↔ MCP tool-definition translation at the
  adapter seam (see `src/core/agent-harness/AGENTS.md`).
