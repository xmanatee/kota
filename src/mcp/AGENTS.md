# MCP

This directory contains Model Context Protocol client/server/manager integration.

- Keep protocol boundaries clean and host-neutral.
- Changes here should preserve clear separation between KOTA internals and MCP transport concerns.

## Key Modules

- `server.ts` — `McpServer` class; JSON-RPC 2.0 over stdio server that exposes KOTA tools, resources, and prompts to MCP-compatible hosts.
- `client.ts` — `McpClient` class; spawns a subprocess and communicates over stdio to consume tools from an external MCP server.
- `manager.ts` — `McpManager`; manages the lifecycle of multiple `McpClient` instances from extension config.
- `resources.ts` — static resource definitions and readers; exposes KOTA state (task queue, workflow status, recent runs) as `kota://` URIs.
- `prompts.ts` — static prompt definitions and renderers; exposes task-creation, workflow-trigger, and run-summarize prompt templates.
