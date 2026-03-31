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

All KOTA tools registered via extensions are available. Use `--tools <name,...>` to restrict exposure.

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

## Capabilities

The server advertises `{ tools: {}, resources: {} }` in its `initialize` response.
Resources are static — no subscriptions (`resources/subscribe`) in this implementation.
