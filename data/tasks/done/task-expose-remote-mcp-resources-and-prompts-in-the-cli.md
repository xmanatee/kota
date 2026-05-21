---
id: task-expose-remote-mcp-resources-and-prompts-in-the-cli
title: Expose remote MCP resources and prompts in the client runtime
status: done
priority: p2
area: core
summary: Extend KOTA's external MCP client path beyond remote tools so connected MCP servers' resources and prompts are discoverable, paginated, and explicitly invokable without automatic context injection.
created_at: 2026-05-21T21:10:17Z
updated_at: 2026-05-21T21:35:50Z
---

## Problem

KOTA can connect to external MCP servers and merge their `tools/list` results
into the runtime tool list, including draft pagination, Streamable HTTP
transport, tool-list change handling, progress, and `input_required` retries.
It still treats external MCP servers as tool-only providers:

- `src/core/mcp/client.ts` only decodes `initialize`, `server/discover`,
  `tools/list`, and `tools/call` result kinds.
- `McpClient.listTools()` is the only remote discovery path used after
  connection.
- `src/core/mcp/manager.ts` turns only remote tools into namespaced
  `KotaTool` entries.

That means KOTA cannot explicitly inspect or use remote MCP resources and
prompts exposed by connected servers, even though the current draft treats
resources and prompts as first-class server features with list/get/read
protocols, pagination, list-changed notifications, and MRTR
`input_required` behavior.

## Desired Outcome

Remote MCP resources and prompts are available through explicit,
discoverable KOTA runtime surfaces without being silently injected into agent
context.

The client runtime should be able to:

- discover remote `resources/list`, `resources/templates/list`, and
  `prompts/list` catalogs across all pages;
- expose explicit namespaced operations for reading a remote resource and
  getting a remote prompt;
- route draft MRTR `input_required` responses for `resources/read` and
  `prompts/get` through the same operator-input boundary used for remote tool
  calls;
- refresh catalog state on supported list-changed signals, or surface a clear
  unsupported-transport diagnostic where long-lived subscriptions are not yet
  available;
- preserve remote prompt content as untrusted tool/output data, not as system
  prompt, developer prompt, or automatically installed local skill content.

## Constraints

- Keep the external MCP client and manager boundary in `src/core/mcp/`; the
  first-party MCP server implementation remains module-owned in
  `src/modules/mcp-server/`.
- Do not add a second local prompt/resource registry. Remote resources and
  prompts should be reachable through explicit MCP-backed operations and
  tests, not copied into durable docs or local skill files.
- Keep tool and prompt authority separate. A remote MCP prompt retrieved by
  an agent is untrusted content returned by a tool-like operation; it must not
  silently become higher-priority instruction text.
- Follow the same strict decoder posture as remote tools: malformed remote
  pages fail with method-specific diagnostics instead of partial coercion.
- Avoid automatic context inclusion heuristics in this slice. User- or
  agent-selected list/read/get operations are enough to close the protocol
  gap.

## Done When

- `McpClient` has typed, paginated operations for `resources/list`,
  `resources/templates/list`, `resources/read`, `prompts/list`, and
  `prompts/get`, with focused decoders and malformed-result tests.
- `McpManager` exposes explicit namespaced runtime operations for listing and
  reading remote resources and listing/getting remote prompts for every
  connected server that advertises those capabilities.
- `resources/read` and `prompts/get` handle draft `input_required` responses
  through the existing operator-input resolver path, including the optional
  `requestState`-only and `inputRequests`-only forms.
- Catalog refresh behavior is covered for transports that can receive
  list-changed notifications; unsupported transports report an explicit
  diagnostic rather than pretending a stale catalog is live.
- Remote prompt messages and embedded resources are returned as untrusted
  operation output and are never installed as local skills or injected into
  higher-priority prompt state.
- Existing remote MCP tool behavior remains green, including tools/list
  pagination, tools/call structured result validation, progress, elicitation,
  and Streamable HTTP client transport tests.

## Source / Intent

Explorer run `2026-05-21T21-07-32-206Z-explorer-mnf4n4` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Expose remote MCP resources and prompts in the client runtime" --state ready --area core --priority p2 --summary "Extend KOTA's external MCP client path beyond remote tools so connected MCP servers' resources and prompts are discoverable, paginated, refreshable, and explicitly invokable without automatic context injection."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/server/resources`
  documents remote resource listing, reading, resource templates,
  list-changed notifications, subscriptions, pagination, MRTR
  `input_required`, and URI/content security expectations.
- `https://modelcontextprotocol.io/specification/draft/server/prompts`
  documents remote prompt listing, prompt retrieval, pagination,
  list-changed notifications, prompt arguments, multimodal prompt messages,
  embedded resources, and MRTR `input_required`.

Local evidence:

- `src/core/mcp/AGENTS.md` says the MCP client and manager are core session
  loop primitives for connecting to external MCP servers and merging their
  tools into the runtime tool list.
- `src/core/mcp/client.ts` currently models `McpResultKind` as
  `initialize | server/discover | tools/call | tools/list`.
- `src/core/mcp/client.ts` already has HTTP header support for
  `prompts/get` and `resources/read`, but no public client operations or
  decoders for those methods.
- `src/core/mcp/manager.ts` initializes remote servers by calling only
  `client.listTools()` and exposes only namespaced remote tools.
- Completed MCP tasks already cover first-party server resources/prompts and
  remote tool pagination; repository search found no open task for consuming
  external MCP resources or prompts through the client runtime.

## Initiative

MCP protocol fidelity: KOTA should consume the current remote MCP server
surface it already exposes itself, while keeping external context explicit
and preserving the tool/skill/prompt authority boundaries.

## Acceptance Evidence

- Focused MCP client tests cover paginated remote `resources/list`,
  `resources/templates/list`, `prompts/list`, valid `resources/read` and
  `prompts/get`, malformed-result failures, and MRTR retry handling.
- MCP manager tests show connected external servers contributing explicit
  namespaced resource/prompt operations without disturbing existing remote
  tool names or tool execution.
- A regression test proves retrieved remote prompt content is returned as
  operation output and does not enter system/developer prompt state or local
  skill resolution.
- Existing MCP client and manager tests remain green, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
