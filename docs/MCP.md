# KOTA MCP Server

KOTA exposes its tools and runtime state over the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) via stdio.

Start the server:

```sh
kota mcp-server
# or with a tool filter:
kota mcp-server --tools file_read,grep
```

Any MCP-compatible host (Claude Code, Cursor, VS Code) can connect and use KOTA's tools.

## Tools

All KOTA built-in tools are available. Extension-contributed tools are included when extensions are loaded before the server starts (the default when using `kota mcp-server`, which calls `loader.loadAll()` automatically). Use `--tools <name,...>` to restrict exposure.

When constructing `McpServer` programmatically (e.g., in the daemon), pass `extensionTools` in `McpServerOptions` to inject extension-contributed tools explicitly without relying on the global tool registry:

```ts
const server = new McpServer({
  extensionTools: myExtension.tools(ctx),
});
```

Extension tools passed via `extensionTools` go through the same `toolFilter` as built-in tools and are routed through their own runners, not the global registry.

## Resources

The server implements `resources/list` and `resources/read`. Three read-only resources are available:

### `kota://tasks/ready`

A JSON array of tasks currently in `tasks/ready/`. Each entry contains:

| Field      | Type   | Description               |
|------------|--------|---------------------------|
| `id`       | string | Task identifier           |
| `title`    | string | Short task title          |
| `priority` | string | Priority label (p1–p3)    |
| `summary`  | string | One-line task description |

### `kota://workflow/status`

A JSON object summarising current runtime state:

| Field            | Type    | Description                                 |
|------------------|---------|---------------------------------------------|
| `activeRunCount` | number  | Number of currently active workflow runs    |
| `paused`         | boolean | Whether the agent backoff pause is active   |
| `workflows`      | object  | Per-workflow last-run status keyed by name  |

Each entry in `workflows`:

| Field              | Type            | Description                          |
|--------------------|-----------------|--------------------------------------|
| `lastStatus`       | string \| null  | Status of the most recent run        |
| `lastRunId`        | string \| null  | ID of the most recent run            |
| `lastCompletedAt`  | string \| null  | ISO timestamp of last completion     |
| `nextScheduledAt`  | string \| null  | ISO timestamp of next scheduled run  |

### `kota://workflow/runs/recent`

A JSON array of the 10 most recent workflow run summaries:

| Field          | Type            | Description                          |
|----------------|-----------------|--------------------------------------|
| `id`           | string          | Run identifier                       |
| `workflow`     | string          | Workflow name                        |
| `status`       | string          | Run status                           |
| `totalCostUsd` | number \| null  | Total cost in USD                    |
| `durationMs`   | number \| null  | Duration in milliseconds             |
| `startedAt`    | string          | ISO start timestamp                  |
| `completedAt`  | string \| null  | ISO completion timestamp             |

## Prompts

The server implements `prompts/list` and `prompts/get`. Three static prompt templates are available:

| Name | Description | Arguments |
|------|-------------|-----------|
| `kota-create-task` | Draft a new task file in the correct frontmatter format | `title` (required), `area`, `priority` |
| `kota-trigger-workflow` | Trigger a workflow by name with an optional JSON payload | `workflow` (required), `payload` |
| `kota-summarize-run` | Summarize a workflow run in plain language | `run_id` (required) |

## Capabilities

The server advertises `{ tools: {}, resources: { subscribe: true }, prompts: {} }` in its `initialize` response.
It supports `resources/subscribe` and `resources/unsubscribe`; subscribed clients receive `notifications/resources/updated` when `kota://workflow/status` or `kota://tasks/ready` changes.

## Elicitation

KOTA supports the MCP elicitation capability (introduced in the 2025-03-26 protocol revision). Elicitation lets the server request structured input from the connected client mid-tool-call.

**Capability negotiation**: Elicitation is opt-in. The server only advertises `elicitation: {}` in its `initialize` response when the client first declares `elicitation: {}` in its own capabilities. Clients that do not advertise elicitation are unaffected.

**`confirm` tool**: When a client supports elicitation, the `confirm` tool uses `sampling/elicit` instead of falling back to `/dev/tty`. The client receives a structured boolean confirmation prompt and the tool result reflects the user's choice (`APPROVED` / `REJECTED`). Without elicitation, `confirm` continues to use the TTY fallback.

**`requestElicitation` API**: Programmatic users of `McpServer` can call `server.requestElicitation(message, schema, timeoutMs?)` directly:

```ts
const result = await server.requestElicitation(
  "Delete all workflow run artifacts?",
  {
    type: "object",
    properties: {
      confirmed: { type: "boolean", title: "Confirm deletion" },
    },
  },
);

if (!result || result.action !== "accept") {
  // cancelled or rejected — abort
} else {
  const approved = result.content.confirmed === true;
}
```

The method returns `null` if the client does not support elicitation, and rejects with an error if the timeout expires before the client responds (default: 300 s).
