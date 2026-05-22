---
id: task-add-mcp-server-card-discovery-for-kotas-first-part
title: Add MCP Server Card discovery for KOTA's first-party MCP server
status: ready
priority: p2
area: modules
summary: Expose KOTA's first-party MCP server metadata through the emerging MCP Server Card discovery shape, reusing existing server.json metadata and MCP resources instead of adding a parallel registry.
created_at: 2026-05-22T07:27:38Z
updated_at: 2026-05-22T07:27:38Z
---

## Problem

KOTA now has strict first-party MCP Registry metadata in `server.json` and a
module-owned MCP server over stdio and Streamable HTTP, but clients still need
to connect through MCP before they can discover the server's identity,
capabilities, and safe public metadata. The MCP Server Card work is explicitly
about pre-connection discovery and resource-based discovery for the same server
facts.

Without a Server Card surface, KOTA's `server.json` remains useful for registry
publication and package validation, but not for browser/client/domain discovery
or for clients that want static metadata before paying the MCP handshake cost.

## Desired Outcome

KOTA exposes a Server Card for its first-party MCP server from the existing
metadata source of truth:

- an MCP resource at `mcp://server-card.json` with `application/json` content;
- a Streamable HTTP discovery endpoint at the current Server Card well-known
  path, using the path from the active MCP Server Card proposal when the task is
  implemented;
- validation that the Server Card is derived from `server.json`,
  `package.json`, and the module-owned MCP capability catalog rather than from
  a second manifest;
- public-only output: no credentials, local/private endpoint leakage, runtime
  session data, project paths, or user-specific state.

## Constraints

- Keep ownership in `src/modules/mcp-server/`. Reuse
  `registry-metadata.ts`, the existing resource handlers, and the
  `streamable-http.ts` adapter unless a shared MCP protocol primitive truly has
  to move.
- Do not create a generic KOTA server-card registry, marketplace, or second MCP
  capability catalog. This is a projection over the first-party MCP server.
- A Server Card is advisory discovery metadata. It must not replace
  `server/discover`, initialization/version checks, authorization, or runtime
  capability validation.
- If the Server Card proposal's path or field names have changed when this is
  implemented, follow the current official proposal and record the source in
  the task evidence. Do not preserve old field names as compatibility aliases.
- Keep exact card schema, field projection, CORS/cache headers, and error
  behavior in source types and focused tests rather than durable prose docs.

## Done When

- `resources/list` includes `mcp://server-card.json` and `resources/read` returns
  a deterministic JSON Server Card with server identity, description,
  supported transports, protocol/capability summary, and only public metadata.
- The Streamable HTTP adapter serves the same JSON through the current
  `.well-known` Server Card path with `application/json`, browser-readable CORS,
  and conservative cache headers; non-GET or malformed discovery requests fail
  without invoking MCP method dispatch.
- The Server Card derives from the existing `server.json` / `package.json`
  validation path and fails loudly if those drift from the card projection.
- Tests prove private localhost/publication-sensitive fields are omitted or
  rejected, and that advertised tool/resource/prompt metadata stays consistent
  with `server/discover` at the coarse capability level.
- Existing MCP registry metadata, resource, Streamable HTTP, and built CLI
  stdio smoke tests remain green.

## Source / Intent

Explorer run `2026-05-22T07-23-17-043Z-explorer-nnzsui` reviewed a queue with
zero actionable `ready`/`doing` tasks. The dependency-waiting backlog tasks
were still blocked on authenticated source access, and all strategic blocked
alternatives were operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add MCP Server Card discovery for KOTA's first-party MCP server" --state ready --area modules --priority p2 --summary "Expose KOTA's first-party MCP server metadata through the emerging MCP Server Card discovery shape, reusing existing server.json metadata and MCP resources instead of adding a parallel registry."
```

It failed before writing a file with `Fatal: fetch failed`, so this normalized
task was created manually.

External signals checked:

- `https://modelcontextprotocol.io/community/server-card/charter` says the
  Server Card WG owns a standardized document format and discovery mechanism,
  with the card format coordinated closely with the Registry WG's
  `server.json` shape.
- `https://modelcontextprotocol.io/development/roadmap` lists MCP Server Cards
  as part of transport evolution and scalability: structured metadata exposed
  through a well-known URL so browsers, crawlers, and registries can discover
  capabilities without connecting.
- `https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649`
  drafts Server Cards as pre-connection metadata exposed both through a
  `.well-known` URI and as an MCP resource at `mcp://server-card.json`, with
  public-only security constraints.

Local evidence:

- `server.json` now describes KOTA's first-party MCP server package metadata.
- `src/modules/mcp-server/registry-metadata.ts` validates `server.json` against
  `package.json` and already rejects non-public remote endpoints.
- `src/modules/mcp-server/resources.ts` owns the read-only MCP resource catalog.
- `src/modules/mcp-server/streamable-http.ts` owns HTTP adapter validation,
  protected-resource metadata, and route-level handling for Streamable HTTP.
- Repository search found no existing Server Card task or implementation.

## Initiative

MCP ecosystem readiness: KOTA's first-party MCP server should be discoverable
through official metadata surfaces while preserving the module-owned MCP
boundary and strict registry metadata source of truth.

## Acceptance Evidence

- Focused MCP server tests pass, including the new Server Card tests and the
  existing registry metadata/resource/Streamable HTTP coverage.
- Built CLI MCP smoke remains green, for example
  `pnpm test src/built-cli-mcp-server.integration.test.ts`.
- A fixture or transcript under `.kota/runs/<run-id>/` captures the
  `mcp://server-card.json` resource response and the well-known HTTP response,
  showing the shared JSON card and the absence of secrets, private endpoints,
  project-local paths, or user/session state.
