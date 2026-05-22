---
id: task-add-mcp-streamable-http-oauth-client-flow
title: Add MCP Streamable HTTP OAuth client flow
status: done
priority: p2
area: core
summary: Let KOTA's HTTP MCP client turn protected-resource authorization challenges into an operator-approved OAuth flow with registration-state binding, PKCE, issuer validation, scoped token storage, and redacted retry behavior.
created_at: 2026-05-22T03:54:39Z
updated_at: 2026-05-22T04:15:25Z
---

## Problem

KOTA's Streamable HTTP MCP client now understands the first layer of the
draft authorization boundary: it can parse `WWW-Authenticate` challenges,
discover OAuth protected-resource metadata, and surface redacted
`McpAuthorizationError` diagnostics. That is a useful stop sign, but it is
not yet an authorization path.

The current MCP draft authorization page also defines how an MCP client
discovers authorization-server metadata, binds credentials and tokens to the
issuer that minted them, registers or identifies itself, runs the
authorization-code flow with PKCE, validates the authorization response
issuer, and retries protected resource calls with scoped bearer tokens. Today
KOTA cannot connect its native MCP manager to a protected remote HTTP MCP
server unless an operator hand-writes a static `Authorization` header in
config. That leaves the standard remote MCP path brittle and encourages token
passthrough instead of a typed, auditable client flow.

## Desired Outcome

KOTA's core MCP client can acquire and use authorization for protected
Streamable HTTP MCP servers through an explicit operator-approved flow:

- Protected-resource metadata discovery feeds authorization-server metadata
  discovery, including issuer validation and per-issuer registration state.
- Config supports strict, typed client identity options: pre-registered client
  credentials, an HTTPS client-id metadata document URL, and dynamic client
  registration only when the authorization server advertises a registration
  endpoint and the operator enables that path.
- The authorization-code flow uses PKCE, validates `state` and issuer (`iss`)
  on callback, binds tokens to the protected MCP resource and authorization
  server issuer, and retries the original MCP request only after a scoped token
  is available.
- Token storage is scoped to the MCP server resource and authorization-server
  issuer, redacted in logs and artifacts, and never passed through from
  unrelated providers.
- Step-up `insufficient_scope` challenges preserve previously granted scopes,
  request the challenge scopes, and fail loudly if reauthorization cannot
  satisfy the current request.

## Constraints

- Keep the client implementation in `src/core/mcp/`; the session loop consumes
  remote MCP tools there. Do not import from the first-party `mcp-server`
  module.
- Do not add an OAuth authorization server to KOTA. This task is about KOTA as
  an OAuth client for protected remote MCP resources.
- Preserve the existing explicit static-header path for operators who already
  own credentials, but keep it clearly separate from acquired OAuth tokens.
- Do not silently select among multiple authorization servers. The selected
  issuer and registration state must be explicit and stable.
- Do not store or print bearer tokens, authorization codes, refresh tokens, or
  client secrets in prompts, run artifacts, console output, or thrown messages.
- Keep exact OAuth/MCP wire shapes in source types and focused tests, not in a
  durable prose catalog.

## Done When

- `src/core/mcp/client.ts` and `manager.ts` accept a strict authorization
  configuration for HTTP MCP servers and reject ambiguous or mixed static vs
  acquired-token configs at load time.
- A protected HTTP MCP server fixture can force a 401 challenge, serve
  protected-resource metadata, serve authorization-server metadata, complete a
  PKCE authorization-code callback, and then receive a retried MCP
  `server/discover`, `tools/list`, or `tools/call` with a scoped bearer token.
- Client tests cover issuer mismatch, missing registration support, DCR opt-in
  disabled, invalid `state`, invalid or absent `iss` when metadata requires it,
  token endpoint failure, insufficient-scope step-up, refresh-token reuse, and
  token redaction.
- Existing Streamable HTTP static-header tests, MCP stdio tests, tool-result
  validation, resource/prompt operations, and authorization-error parsing tests
  remain green.
- Operator-facing output names the server, resource, issuer, and required
  scopes without exposing token material, and gives a deterministic next step
  when interactive authorization is required but no operator surface is
  available.

## Source / Intent

Explorer run `2026-05-22T03-51-57-932Z-explorer-3jn32u` reviewed a queue with
zero actionable ready/doing work. All strategic blocked alternatives exposed
by `inspect-queue` remained operator-capture blocked and non-movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add MCP Streamable HTTP OAuth client flow" --state ready --area core --priority p2 --summary "Let KOTA's HTTP MCP client turn protected-resource authorization challenges into an operator-approved OAuth flow with registration-state binding, PKCE, issuer validation, scoped token storage, and redacted retry behavior."
```

It failed before writing a file with `Fatal: fetch failed`, so this task was
normalized manually.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/basic/authorization`
  documents MCP HTTP authorization beyond challenge parsing: protected-resource
  metadata, authorization-server metadata discovery, client registration
  approaches, authorization-code flow validation, resource parameter handling,
  token usage, refresh tokens, scope challenge handling, and security
  considerations.

Local evidence:

- `src/core/mcp/AGENTS.md` says the MCP client and manager are session-loop
  primitives and stay in core.
- `src/core/mcp/client.ts` currently parses 401/403 challenges, discovers
  protected-resource metadata, and throws `McpAuthorizationError`.
- `src/core/mcp/manager.ts` currently accepts `headers` for HTTP MCP servers,
  so acquired OAuth state has no typed config/storage boundary yet.
- Completed task `task-add-mcp-streamable-http-authorization-support` explicitly
  stopped at the metadata/challenge/verifier seams and did not add a general
  OAuth provider flow.

## Initiative

MCP protocol fidelity and safe remote capability use: KOTA should consume
protected HTTP MCP servers through a typed authorization path instead of
requiring static token passthrough.

## Acceptance Evidence

- Focused MCP client and manager tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- A fake protected-resource and authorization-server fixture demonstrates
  challenge discovery, authorization-code completion, token-bound retry, and
  step-up scope handling without live external services.
- Negative tests or fixtures prove tokens, codes, refresh tokens, and client
  secrets are redacted from errors, console output, and run artifacts.
