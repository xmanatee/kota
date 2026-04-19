# MCP Server Module

This directory owns the `mcp-server` repo module — exposes KOTA tools via
the Model Context Protocol over stdio.

- Registers the `kota mcp-server` CLI command.
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
