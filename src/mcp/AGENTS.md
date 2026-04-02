# MCP

This directory contains Model Context Protocol client/server/manager integration.

- Keep protocol boundaries clean and host-neutral.
- Changes here should preserve clear separation between KOTA internals and MCP transport concerns.

## Key Modules

- `server.ts` — `McpServer` class; JSON-RPC 2.0 over stdio server that exposes KOTA tools, resources, and prompts to MCP-compatible hosts. Supports `resources/subscribe` and `resources/unsubscribe` per MCP 2024-11-05; sends `notifications/resources/updated` via the EventBus when workflow status or task queue changes. Accepts optional `extensionTools` in `McpServerOptions` to inject extension-contributed tools explicitly alongside built-in tools. Supports MCP elicitation (2025-03-26 spec): advertises `elicitation: {}` when client supports it, exposes `requestElicitation(message, schema, timeoutMs?)` for structured user input mid-tool-call, and routes the `confirm` tool through elicitation when available. Supports MCP sampling: advertises `sampling: {}` and handles `sampling/createMessage` when `samplingEnabled` and a `modelClient` are provided; cost is recorded as a synthetic run artifact under `mcp-sampling` in `.kota/runs/`. Supports MCP completions: always advertises `completions: {}`, handles `completion/complete` for prompt argument autocomplete — workflow names for `kota-trigger-workflow` and recent run IDs for `kota-summarize-run`. Supports MCP roots: always advertises `roots: {}`, requests `roots/list` from the client after initialization when the client declares roots capability, listens for `notifications/roots/list_changed` to refresh; exposes `getClientRoots()` and `getEffectiveProjectDir()` — the latter returns the first client root's file path when roots are provided, otherwise the configured `projectDir`.
- `client.ts` — `McpClient` class; spawns a subprocess and communicates over stdio to consume tools from an external MCP server.
- `manager.ts` — `McpManager`; manages the lifecycle of multiple `McpClient` instances from extension config.
- `resources.ts` — static resource definitions and readers; exposes KOTA state (task queue, workflow status, recent runs) as `kota://` URIs.
- `prompts.ts` — static prompt definitions and renderers; exposes task-creation, workflow-trigger, and run-summarize prompt templates.
