# MCP Registry Module

This module owns operator-facing import from MCP Registry-compatible metadata
into KOTA external MCP server configuration.

- Keep this as a config import surface, not a runtime capability registry.
- Decode registry metadata at the boundary, then emit the same strict
  `mcpServers` config shape the core MCP manager already consumes.
- Do not execute, install, or probe registry packages during import.
- Keep registry field support and diagnostics in focused source tests rather
  than durable prose catalogs.
