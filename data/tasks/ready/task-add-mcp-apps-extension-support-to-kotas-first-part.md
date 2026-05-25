---
id: task-add-mcp-apps-extension-support-to-kotas-first-part
title: Add MCP Apps extension support to KOTA's first-party MCP server
status: ready
priority: p2
area: modules
summary: Expose a minimal MCP Apps extension surface from KOTA's first-party MCP server so app-capable hosts can discover sandboxed interactive UI resources without turning apps into a second capability registry.
created_at: 2026-05-25T06:10:08.455Z
updated_at: 2026-05-25T06:10:08.455Z
---

## Problem

KOTA's first-party MCP server has caught up with the current core MCP draft
across tools, resources, prompts, completion, MRTR, sampling, elicitation,
tasks, logging, caching, progress, registry metadata, Server Card, stdio, and
Streamable HTTP. The next visible MCP platform surface is no longer a core
method; it is the official MCP Apps extension.

MCP Apps lets a server pair ordinary MCP tools and resources with sandboxed
interactive HTML interfaces rendered inside app-capable hosts. KOTA currently
has no `io.modelcontextprotocol/ui` extension negotiation, no `ui://` resource
shape, and no way for an MCP tool or resource to declare `_meta.ui.resourceUri`.
That means app-capable hosts can use KOTA as text/JSON MCP only, even for
operator workflows that are naturally visual or multi-step.

This should not become a separate app registry or client framework inside
KOTA. The useful first slice is an MCP-server adapter surface that proves KOTA
can expose a small, safe, app-capable UI resource while preserving meaningful
plain text / JSON behavior for clients that do not support the extension.

## Desired Outcome

KOTA's `mcp-server` module supports the MCP Apps extension as an optional,
module-owned adapter over existing KOTA capabilities:

- App-capable clients can discover that KOTA supports
  `io.modelcontextprotocol/ui`.
- `resources/list` / `resources/read` can expose at least one bounded
  `ui://` resource with the MCP Apps HTML mime type and explicit UI metadata.
- At least one existing KOTA MCP surface advertises `_meta.ui.resourceUri`
  only when doing so is safe and still has a complete non-UI fallback.
- Non-app clients continue to receive useful core MCP responses without
  needing to understand the extension.

## Constraints

- Keep implementation under `src/modules/mcp-server/` unless a genuinely
  shared MCP type has to move. Do not add a parallel app/plugin registry.
- Treat MCP Apps as an extension to the existing tool/resource adapter layer.
  KOTA capabilities remain contributed through modules, tools, resources, and
  prompts.
- Keep the first app resource static or server-rendered and self-contained.
  Do not add a frontend build system, web dashboard dependency, or client app
  runtime as part of this slice.
- Set restrictive UI metadata by default: sandbox-friendly HTML, explicit CSP,
  no ambient external scripts, no broad permissions, and no credential-bearing
  data in the resource body.
- Do not add `@modelcontextprotocol/ext-apps` unless it removes real local
  complexity. The official docs say direct protocol implementation is valid.
- If the client does not advertise the UI extension, fall back to core MCP
  behavior rather than failing an otherwise valid request.
- Keep exact extension identifiers, `_meta` keys, mime types, and wire shapes
  in source types and focused protocol tests, not durable prose docs.

## Done When

- `initialize` / `server/discover` surfaces extension support using the
  official `extensions` capability shape for `io.modelcontextprotocol/ui`.
- The server recognizes app-capable client capability metadata without
  silently accepting malformed internal capability shapes.
- `resources/list` includes at least one `ui://...` app resource when
  applicable, and `resources/read` returns bounded HTML with
  `text/html;profile=mcp-app` or the current official MCP Apps mime shape plus
  `_meta.ui` CSP/permission metadata.
- At least one tool or resource path exposes `_meta.ui.resourceUri` for
  app-capable hosts while retaining complete text/JSON content for ordinary
  hosts.
- Tests cover supported-client negotiation, unsupported-client fallback,
  malformed extension metadata rejection, resource read shape, and the
  app-enhanced tool/resource fallback.
- Existing MCP server tests remain green.

## Source / Intent

Explorer run `2026-05-25T06-08-20-922Z-explorer-oy0eej` reviewed an empty
actionable queue. All strategic blocked alternatives still require
operator-captured artifacts and are not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://modelcontextprotocol.io/extensions/apps/overview` says MCP Apps
  lets servers return interactive HTML interfaces in MCP hosts, using a
  tool-declared `_meta.ui.resourceUri` that points at a `ui://` resource, with
  sandboxed iframe rendering and JSON-RPC over `postMessage`.
- `https://modelcontextprotocol.io/extensions/overview` says MCP extensions
  negotiate through `capabilities.extensions`, official extensions use the
  `io.modelcontextprotocol` vendor prefix, and the UI extension identifier is
  `io.modelcontextprotocol/ui`.
- `https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/` says MCP
  Apps is live as an official MCP extension, with support across clients such
  as Claude, Goose, VS Code, and ChatGPT.

Local evidence:

- `src/modules/mcp-server/AGENTS.md` says MCP belongs in the module as a
  transport over KOTA capabilities, not as a second capability registry.
- `src/modules/mcp-server/mcp-capabilities.ts` has core MCP capability
  summaries but no `extensions` capability.
- `src/modules/mcp-server/resources.ts` exposes JSON resources only and has no
  `ui://` resource support.
- Repository search found no existing open MCP Apps, `ui://`, or
  `io.modelcontextprotocol/ui` task.

## Initiative

MCP protocol fidelity: KOTA's first-party MCP server should track the current
official platform surfaces while keeping MCP as an adapter over KOTA modules,
not a parallel product framework.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/mcp-server/mcp-protocol-types.test.ts src/modules/mcp-server/server-card.test.ts`.
- A protocol fixture or run artifact under `.kota/runs/<run-id>/` shows an
  app-capable MCP client initializing, observing `io.modelcontextprotocol/ui`,
  listing and reading the `ui://` resource, and receiving the same underlying
  tool/resource result through the plain fallback path.
- Diff review shows no new MCP Apps registry, frontend build surface, or
  client-specific UI dependency outside the `mcp-server` adapter.
