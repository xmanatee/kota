# MCP Server Extension

This directory owns the `mcp-server` built-in extension — exposes KOTA tools via the Model Context Protocol.

- Registers `kota mcp-server` CLI command (starts stdio MCP server).
- Actual MCP server implementation lives in `src/mcp/server.ts`.
- Supports `--tools` filter and `--name` override flags.
- Passes `samplingEnabled` and `ModelClient` when `mcp.sampling.enabled` is true in config.

## Files

- `index.ts` — `KotaExtension` definition; `kota mcp-server` CLI command.
