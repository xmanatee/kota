---
id: task-support-paginated-mcp-toolslist-in-the-client-runtime
title: Support paginated MCP tools/list in the client runtime
status: done
priority: p2
area: core
summary: Follow MCP cursor pagination for remote tools/list discovery so KOTA does not silently drop tools from servers that advertise more than one page.
created_at: 2026-05-20T02:26:38Z
updated_at: 2026-05-20T02:38:29Z
---

## Problem

KOTA's MCP client currently requests `tools/list` once and decodes only the
`tools` array from that single result. There is no `nextCursor` handling in
`src/core/mcp/`, so a compliant remote MCP server that paginates tool
discovery can expose only the first page to KOTA while the remaining tools are
silently absent from the runtime tool list.

The MCP pagination spec lists `tools/list` as a paginated operation. Claude
Code's 2026-05-19 release also fixed a peer-runtime bug where MCP servers with
paginated `tools/list` responses returned only the first page and silently
dropped tools, which is the exact failure shape KOTA should guard against.

## Desired Outcome

KOTA discovers every page of a remote MCP server's advertised tools before
registering them in the session tool list. If pagination is malformed or loops,
the failure is explicit and names the server instead of leaving operators with
a partial tool inventory.

## Constraints

- Keep this in the MCP client boundary. The server-side `mcp-server` module may
  continue to return a single page unless a separate need appears.
- Treat MCP cursors as opaque strings. Do not parse, persist, or synthesize
  cursor values.
- Preserve strict protocol decoding: malformed `nextCursor`, malformed tool
  definitions on any page, or repeated cursors should fail loudly with a
  diagnostic that points to `tools/list`.
- Do not add a parallel MCP discovery path or compatibility mode. The existing
  `McpClient.listTools()` / `McpManager.initialize()` path should become the
  paginated path.

## Done When

- `McpClient.listTools()` follows `nextCursor` until the server omits it and
  returns the concatenated tool list.
- Each follow-up request sends the prior cursor in `params.cursor`.
- Tests cover at least: one-page discovery, two-page discovery, malformed
  `nextCursor`, a repeated-cursor loop guard, and malformed tool data on a
  later page.
- `McpManager.initialize()` registers tools from every page and preserves the
  existing namespacing, output-schema validation, and connection-failure
  behavior.

## Source / Intent

- MCP pagination spec:
  https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination
- Claude Code release v2.1.144:
  https://github.com/anthropics/claude-code/releases/tag/v2.1.144

This task came from the 2026-05-20 explorer watchlist refresh. The local code
already supports several draft MCP tool-result details, but tool discovery
pagination is still absent and can make a remote server look less capable than
it is.

## Initiative

MCP client correctness: KOTA should interoperate with compliant remote MCP
servers without silently dropping tools at discovery time.

## Acceptance Evidence

- Focused MCP client and manager tests demonstrate multi-page `tools/list`
  discovery and explicit malformed-pagination failures.
- A validation transcript shows the focused MCP test suite passing, for
  example `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
