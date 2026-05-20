---
id: task-reject-invalid-mcp-x-mcp-header-annotations-during
title: Reject invalid MCP x-mcp-header annotations during tool discovery
status: done
priority: p2
area: core
summary: Reject remote MCP tools whose input schema uses malformed x-mcp-header annotations so KOTA follows the draft Tools boundary instead of registering unsafe or unroutable header mappings.
created_at: 2026-05-20T03:41:09Z
updated_at: 2026-05-20T03:51:26Z
---

## Problem

KOTA's MCP client accepts remote tool input schemas after validating only the
top-level object shape, `properties`, `required`, and optional output schema.
It does not inspect nested schema properties for the MCP draft
`x-mcp-header` annotation. A remote MCP server can therefore advertise a tool
whose header-mirroring annotation is empty, non-ASCII, duplicated, applied to a
non-primitive property, or otherwise malformed, and KOTA will still register
the tool into the session runtime.

The current MCP draft Tools spec says clients must reject tool definitions
where `x-mcp-header` violates its constraints and should log a warning naming
the rejected tool and reason. This belongs at KOTA's external MCP client
boundary; letting an invalid header annotation through makes the runtime
appear compatible while silently accepting a protocol shape it cannot safely
honor.

## Desired Outcome

Remote MCP tool discovery validates `x-mcp-header` annotations before tools are
registered:

- malformed annotated tool definitions are excluded from the discovered tool
  list rather than being converted into neutral `KotaTool` entries;
- the warning names the MCP server, tool, and exact rejection reason;
- other valid tools from the same `tools/list` response remain usable; and
- KOTA does not invent a KOTA-only header transport, compatibility mode, or
  second schema representation while adding this check.

## Constraints

- Keep validation in `src/core/mcp/`, where external MCP tool schemas enter
  the session runtime. The first-party MCP server module may stay unchanged
  unless a focused test needs a fixture helper.
- Treat `x-mcp-header` as an external protocol annotation on JSON Schema
  properties, not as a new neutral KOTA tool field.
- Enforce the draft constraints exactly enough to be useful: non-empty ASCII
  header values excluding space and `:`, case-insensitive uniqueness within one
  input schema, and use only on primitive `string`, `number`, or `boolean`
  properties.
- Do not reject an entire MCP server when one tool definition is invalid.
  Exclude the invalid tool, keep the valid tools, and make the diagnostic
  visible.
- Keep exact MCP wire details in source types and focused tests, not in durable
  docs.

## Done When

- `McpClient.listTools()` or the adjacent decode path rejects individual
  remote tool definitions whose `inputSchema` contains invalid `x-mcp-header`
  annotations while preserving valid tools from the same page.
- The rejection diagnostic includes the server name, tool name when available,
  and whether the failure was empty value, forbidden character, duplicate
  header, or non-primitive annotated property.
- Tests cover at least: one valid annotated primitive property, empty header
  value, header containing space or colon, duplicate header values differing
  only by case, annotation on an object or array property, and mixed valid plus
  invalid tools in one response.
- Existing MCP pagination, output-schema, rich-result, and input-required tests
  remain green.

## Source / Intent

Explorer run `2026-05-20T03-38-50-784Z-explorer-083n4r` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured evidence, so this opens one ready MCP interoperability slice
instead of adding another blocked item or client fan-out review.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/tools` is the
  official MCP draft Tools page. It documents `x-mcp-header`, including the
  client-side requirement to reject tool definitions whose annotation value is
  empty, contains forbidden characters, is duplicated case-insensitively, or is
  applied outside primitive parameters.

Local evidence:

- `src/core/mcp/client.ts` decodes remote tool definitions and validates
  `inputSchema` only as an object schema with optional `properties` and
  `required`.
- `src/core/mcp/manager.ts` converts accepted remote schemas into neutral
  `KotaTool` entries, so any invalid schema accepted by the client becomes an
  available runtime tool.
- Existing completed MCP tasks cover pagination, rich result preservation,
  draft tool-result variants, and output schema validation, but not
  `x-mcp-header` validation.

## Initiative

MCP protocol fidelity: KOTA should consume external MCP tools through a strict
boundary that rejects malformed protocol annotations before they reach the
agent runtime.

## Acceptance Evidence

- Focused MCP client and manager tests pass, for example:
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Test fixtures show a mixed `tools/list` response where a valid tool is
  registered, an invalid `x-mcp-header` tool is excluded, and the warning gives
  an actionable rejection reason.
