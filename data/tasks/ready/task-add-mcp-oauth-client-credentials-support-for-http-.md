---
id: task-add-mcp-oauth-client-credentials-support-for-http-
title: Add MCP OAuth client credentials support for HTTP servers
status: ready
priority: p2
area: core
summary: Let KOTA's HTTP MCP client use the official MCP OAuth Client Credentials extension for noninteractive machine-to-machine authorization, with strict metadata validation, scoped token binding, and secret redaction.
created_at: 2026-05-25T07:20:59.529Z
updated_at: 2026-05-25T07:20:59.529Z
---

## Problem

KOTA's Streamable HTTP MCP client can now handle the core OAuth authorization-code
flow for protected remote MCP servers, but it always assumes an interactive
operator-approved redirect path when acquired tokens are needed. That is the
right default for user-delegated access, but the official MCP Authorization
Extensions now define a separate OAuth Client Credentials extension for
machine-to-machine MCP access.

KOTA already has the nearby ingredients: protected-resource metadata discovery,
authorization-server metadata discovery, typed HTTP MCP authorization config,
registered client identity, scoped token binding, refresh handling, and token
redaction. What is missing is a strict noninteractive authorization mode that
uses `grant_type=client_credentials` when an MCP server and authorization server
explicitly support that extension. Operators who connect KOTA to service-owned
remote MCP servers must currently either paste a static `Authorization` header
or wire an unnecessary browser callback flow; both weaken the typed, auditable
remote-MCP boundary KOTA has been building.

## Desired Outcome

KOTA's HTTP MCP client supports the official OAuth Client Credentials extension
as an explicit authorization mode for protected Streamable HTTP MCP servers.
For servers configured for this mode, KOTA discovers protected-resource and
authorization-server metadata, validates that the issuer/resource/scopes match
the operator's config, exchanges pre-registered client credentials for a scoped
Bearer token without invoking an interactive resolver, binds the token to the
MCP resource and issuer, and retries the original MCP request with redacted
diagnostics.

This should extend the existing OAuth client path rather than adding a second
authorization stack. Interactive authorization-code, static-header, and
client-credentials modes must remain distinct at configuration and runtime
boundaries.

## Constraints

- Keep the implementation in `src/core/mcp/`; the session loop consumes remote
  MCP clients there, and the first-party `mcp-server` module must not become a
  dependency.
- Treat client credentials as explicit operator configuration. Do not infer it
  from the presence of a `clientSecret`, and do not fall back from an
  interactive mode to client credentials silently.
- Support only pre-registered client credentials in this slice. The official
  extension says Dynamic Client Registration is not used for the client
  credentials flow.
- Validate authorization-server metadata before using the flow:
  `token_endpoint_auth_methods_supported` must include a supported method such
  as `client_secret_basic` or `private_key_jwt`; JWT auth can be a follow-up if
  this task chooses to ship `client_secret_basic` first.
- Include the `resource` parameter and requested scopes in token requests, bind
  the returned token to the protected MCP resource and issuer, and fail loudly
  when granted scopes do not cover the request.
- Keep token material, client secrets, assertions, and authorization headers out
  of prompts, thrown messages, console output, and run artifacts.
- Preserve the existing authorization-code flow, refresh-token behavior, static
  `Authorization` header path, and HTTP MCP transport tests.

## Done When

- The HTTP MCP server config accepts a strict client-credentials authorization
  mode and rejects malformed or mixed interactive/static/client-credentials
  configurations at load time.
- A protected HTTP MCP fixture can force a 401 challenge, serve protected-
  resource metadata, serve authorization-server metadata that advertises a
  supported client-credentials auth method, receive a
  `grant_type=client_credentials` token request with `resource` and `scope`, and
  observe the original MCP request retried with the scoped Bearer token.
- Negative tests cover issuer mismatch, missing protected-resource metadata,
  unsupported token-endpoint auth methods, missing configured client secret for
  the chosen method, token endpoint failure, insufficient granted scope,
  refresh/expiry behavior if no refresh token is returned, and redaction of
  client secrets and tokens.
- Interactive authorization-code mode still invokes the resolver and uses PKCE;
  client-credentials mode never invokes the resolver.
- Existing MCP client and manager tests remain green.

## Source / Intent

Explorer run `2026-05-25T07-17-38-425Z-explorer-v0sulo` reviewed an empty
actionable queue. All strategic blocked alternatives exposed by
`inspect-queue` still require operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://modelcontextprotocol.io/extensions/overview` lists official MCP
  Authorization Extensions and says extensions negotiate through
  `capabilities.extensions`, are optional, disabled by default, and should
  gracefully degrade or reject when mandatory.
- `https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials`
  defines the OAuth Client Credentials extension for HTTP-based MCP
  machine-to-machine authentication, requiring pre-registered client
  credentials, no Dynamic Client Registration, protected-resource metadata,
  authorization-server metadata, `grant_type=client_credentials`, `resource`,
  requested scopes, and strict token/credential security.

Local evidence:

- `src/core/mcp/AGENTS.md` says the external MCP client and manager stay in
  core because the session loop consumes them directly.
- `src/core/mcp/client-auth-types.ts` and `manager.ts` currently model HTTP MCP
  acquired authorization only as `type: "oauth"` with `issuer`,
  `redirectUri`, `scopes`, and a registered/client-id-metadata/dynamic client
  identity. There is no flow discriminator for client credentials.
- `src/core/mcp/client-authorization-runtime.ts` always calls
  `runAuthorizationCodeFlow(...)` after metadata and client resolution, so a
  protected remote MCP server cannot be authorized noninteractively through the
  official extension.
- Completed task `task-add-mcp-streamable-http-oauth-client-flow` intentionally
  covered the core authorization-code flow, not the later official
  client-credentials extension.

## Initiative

MCP protocol fidelity and safe remote capability use: KOTA should consume
protected remote MCP servers through typed authorization modes instead of
forcing static token passthrough or an unnecessary user-interactive OAuth flow.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- A fake protected-resource / authorization-server fixture demonstrates
  client-credentials discovery, token exchange, scoped retry, unsupported-method
  failure, and redaction without live external services.
- Config-decoder tests show interactive OAuth, static headers, and
  client-credentials mode are mutually explicit and cannot be mixed silently.
