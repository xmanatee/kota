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

The server implements `resources/list` and `resources/read`. Five read-only resources are available:

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

### `kota://memory`

A JSON array of all memory entries:

| Field       | Type     | Description                          |
|-------------|----------|--------------------------------------|
| `id`        | string   | Entry identifier                     |
| `content`   | string   | Memory note text                     |
| `tags`      | string[] | Tags associated with the entry       |
| `createdAt` | string   | ISO timestamp of creation            |

### `kota://knowledge`

A JSON array of all knowledge entries:

| Field       | Type            | Description                          |
|-------------|-----------------|--------------------------------------|
| `id`        | string          | Entry identifier                     |
| `title`     | string          | Short entry title                    |
| `content`   | string          | Entry body text                      |
| `tags`      | string[]        | Tags associated with the entry       |
| `source`    | string \| null  | Source URL or reference, if set      |
| `createdAt` | string          | ISO timestamp of creation            |

Both resources return an empty array when the corresponding provider has no entries.

## Prompts

The server implements `prompts/list` and `prompts/get`. Three static prompt templates are available:

| Name | Description | Arguments |
|------|-------------|-----------|
| `kota-create-task` | Draft a new task file in the correct frontmatter format | `title` (required), `area`, `priority` |
| `kota-trigger-workflow` | Trigger a workflow by name with an optional JSON payload | `workflow` (required), `payload` |
| `kota-summarize-run` | Summarize a workflow run in plain language | `run_id` (required) |

## Completions

The server implements `completion/complete` for argument autocomplete in supported hosts (Claude Code, Cursor):

| Prompt | Argument | Completion source |
|--------|----------|-------------------|
| `kota-trigger-workflow` | `workflow` | All registered workflow names, filtered by prefix |
| `kota-summarize-run` | `run_id` | 20 most recent run IDs from the run store, filtered by prefix |

When a user types a partial value in a compatible host, the host sends a `completion/complete` request and the server returns matching values as `{ completion: { values: string[], hasMore: boolean } }`. Free-text arguments (e.g., `payload`, `title`) return an empty list.

## Capabilities

The server advertises `{ tools: {}, resources: { subscribe: true }, prompts: {}, completions: {}, roots: {} }` in its `initialize` response. When `mcp.sampling.enabled` is true, `sampling: {}` is also included.
It supports `resources/subscribe` and `resources/unsubscribe`; subscribed clients receive `notifications/resources/updated` when `kota://workflow/status` or `kota://tasks/ready` changes.

## Roots

KOTA supports the MCP roots capability, allowing connected clients (MCP hosts) to declare which workspace directories are active. This lets the server scope file-system operations to the operator's project workspace.

**Capability negotiation**: When the client declares `roots: {}` in its `initialize` capabilities, KOTA sends a `roots/list` request back to the client immediately after initialization to retrieve the current workspace roots.

**Root updates**: When the client sends `notifications/roots/list_changed`, KOTA sends a fresh `roots/list` request to update its stored roots list.

**Effective project directory**: When roots are provided, the first root's `file://` URI is used as the project directory for resource reads (`kota://tasks/ready`, `kota://workflow/status`, etc.), overriding the configured `projectDir`. This ensures resources reflect the client's active workspace rather than the daemon's working directory.

**Accessing roots programmatically**: `McpServer` exposes two public methods:

```ts
// Returns the current list of client-provided roots
server.getClientRoots(); // Array<{ uri: string; name?: string }>

// Returns the first root's file path if available, otherwise the configured projectDir
server.getEffectiveProjectDir(); // string
```

Roots are per-connection and not shared across server instances.

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

## Sampling

KOTA supports the MCP sampling capability, allowing connected clients to request LLM completions through KOTA's configured model provider.

**Config flag**: Sampling is opt-in and disabled by default. Enable it in `.kota/config.json`:

```json
{
  "mcp": {
    "sampling": {
      "enabled": true
    }
  }
}
```

**Capability negotiation**: When `mcp.sampling.enabled` is true, the server advertises `sampling: {}` in its `initialize` response. Clients can then send `sampling/createMessage` requests.

**`sampling/createMessage`**: The server routes the request through the configured model provider (the same `ModelClient` used by agent steps). The caller supplies messages, an optional system prompt, and a `maxTokens` budget; the server returns the completion.

| Field | Type | Description |
|-------|------|-------------|
| `messages` | array | MCP `SamplingMessage` array (`role` + `content`) |
| `systemPrompt` | string (optional) | System prompt prepended to the conversation |
| `maxTokens` | number | Maximum tokens for the completion (default: 1024) |

Response fields:

| Field | Type | Description |
|-------|------|-------------|
| `role` | `"assistant"` | Always `"assistant"` |
| `content` | `{ type: "text"; text: string }` | The model's text response |
| `model` | string | Model that produced the response |
| `stopReason` | `"endTurn"` \| `"maxTokens"` \| string | Why generation stopped |

**Cost tracking**: Each sampling call writes a synthetic run artifact to `.kota/runs/` under the workflow name `mcp-sampling`. These entries appear in `kota workflow cost` output so sampling spend is visible alongside workflow costs.
