---
id: task-add-mcp-streamable-http-authorization-support
title: Add MCP Streamable HTTP authorization support
status: ready
priority: p2
area: modules
summary: Align KOTA's Streamable HTTP MCP client and first-party server with the draft authorization and security guidance: protected-resource metadata discovery, bearer-token validation, scoped 401/403 challenges, and no token passthrough.
created_at: 2026-05-21T22:30:45Z
updated_at: 2026-05-21T22:30:45Z
---

## Problem

KOTA now has Streamable HTTP support on both sides of MCP: the external MCP
client can send static HTTP headers, and the first-party MCP server has a
module-owned HTTP adapter. That closes local protocol reachability, but the
authorization boundary is still missing.

The current MCP draft authorization page defines HTTP-based authorization
around OAuth protected-resource metadata, `WWW-Authenticate` discovery,
Bearer-token use on every HTTP request, token audience validation, scoped
401/403 challenges, and step-up scope handling. The companion security guide
also calls out token passthrough, confused-deputy, SSRF, session hijacking,
and local HTTP server exposure risks.

Today the server adapter rejects non-local binding with "without an
authentication story", but there is no story to turn on. The client accepts
caller-supplied static headers but does not parse MCP authorization challenges,
discover protected-resource metadata, preserve per-authorization-server state,
or make token-audience mistakes impossible at the boundary.

## Desired Outcome

KOTA has a strict, incremental MCP authorization boundary for Streamable HTTP:

- First-party MCP server HTTP mode can be configured as a protected resource,
  including a resource metadata endpoint or `WWW-Authenticate` resource
  metadata challenge, required scopes, and a token verifier boundary.
- Missing, malformed, expired, wrong-audience, and insufficient-scope tokens
  return spec-shaped 401/403 responses with `WWW-Authenticate` details before
  MCP handler dispatch.
- External MCP HTTP client code recognizes 401/403 MCP authorization
  challenges, parses protected-resource metadata discovery hints, and surfaces
  actionable typed errors or operator-input requests instead of treating auth
  failures as generic transport errors.
- Static `headers.Authorization` remains possible only as explicit
  operator-supplied credentials for a known server; KOTA does not pass through
  arbitrary third-party tokens or log token material.

## Constraints

- Keep server work in `src/modules/mcp-server/` unless a shared protocol type
  genuinely belongs in `src/core/mcp/`.
- Keep external client work in `src/core/mcp/`, where the session loop already
  consumes remote MCP tools.
- Do not add a general OAuth provider framework in this task. Define the KOTA
  seams: metadata parsing, challenge parsing, token verifier/provider
  interfaces, scope classification, and strict error behavior.
- Do not make non-local binding the default. Localhost remains the safe
  default; authenticated non-local binding must require explicit operator
  configuration.
- Never accept token passthrough. Tokens must be validated for the MCP server
  audience/resource before a protected server dispatches the request.
- Do not put secrets, tokens, or full auth documents into run artifacts,
  prompts, or error messages.
- Exact wire shapes belong in code and focused tests, not a prose catalog in
  durable docs.

## Done When

- `src/modules/mcp-server/streamable-http.ts` can enforce a protected-resource
  mode that rejects unauthorized requests before `McpServer` dispatch.
- The server exposes or advertises protected-resource metadata with required
  scopes and canonical resource identity; handler tests cover both the
  well-known path and `WWW-Authenticate` discovery challenge.
- Server tests cover missing token, malformed bearer header, verifier reject,
  wrong audience, insufficient scope, and successful scoped dispatch.
- `src/core/mcp/client.ts` / `manager.ts` preserve existing static-header
  behavior while distinguishing MCP authorization failures from generic HTTP
  errors, including parsed challenge metadata and required scopes.
- Client tests cover 401 protected-resource metadata discovery, 403
  insufficient-scope challenge parsing, redacted error surfaces, and no token
  leakage in thrown messages.
- Existing MCP HTTP transport, tools, resources, prompts, MRTR, progress, and
  Streamable HTTP tests remain green.

## Source / Intent

Explorer run `2026-05-21T22-28-26-378Z-explorer-igoru3` reviewed an empty
actionable queue. All strategic blocked alternatives exposed by
`inspect-queue` remained operator-capture blocked and non-movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add MCP Streamable HTTP authorization support" --state ready --area modules --priority p2 --summary "Align KOTA's Streamable HTTP MCP client and first-party server with the draft authorization and security guidance: protected-resource metadata discovery, bearer-token validation, scoped 401/403 challenges, and no token passthrough."
```

It failed before writing a file with `Fatal: fetch failed`, so this file
follows the normalized task schema manually.

External sources checked:

- `https://modelcontextprotocol.io/specification/draft/basic/authorization`
  defines HTTP transport authorization, OAuth protected-resource metadata,
  `WWW-Authenticate` discovery, `Authorization: Bearer` usage, resource
  indicators, audience validation, and 401/403 scope challenges.
- `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
  calls out token passthrough, confused deputy, SSRF during OAuth discovery,
  session hijacking, and local HTTP server exposure mitigations.

Local evidence:

- `src/modules/mcp-server/streamable-http.ts` validates Streamable HTTP
  protocol headers and local origins, but has no protected-resource metadata,
  token verifier, or auth challenge handling.
- `src/modules/mcp-server/streamable-http.ts` rejects non-local bind hosts
  because there is no authentication story.
- `src/core/mcp/manager.ts` accepts static HTTP headers, and existing tests
  prove a configured `Authorization` header is forwarded, but there is no
  typed MCP authorization discovery or challenge path.

## Initiative

MCP protocol fidelity and safe remote exposure: KOTA should expose module-owned
MCP capabilities through standard HTTP transport without creating a token
passthrough or open-listener footgun.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/modules/mcp-server/streamable-http.test.ts src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- A redacted fixture or test transcript proves unauthorized MCP HTTP requests
  are rejected before tool/resource/prompt dispatch, while an authorized
  scoped request reaches the existing handler path.
- Negative tests prove bearer tokens and protected-resource metadata are not
  written to thrown messages, prompts, run artifacts, or console warnings.
