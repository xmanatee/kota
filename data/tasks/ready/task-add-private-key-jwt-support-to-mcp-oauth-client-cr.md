---
id: task-add-private-key-jwt-support-to-mcp-oauth-client-cr
title: Add private-key JWT support to MCP OAuth client credentials
status: ready
priority: p2
area: core
summary: Let KOTA's HTTP MCP client use the official private_key_jwt credential format for OAuth Client Credentials MCP servers, with strict JWT assertion construction, metadata validation, scoped token binding, and redacted diagnostics.
created_at: 2026-05-25T08:08:51.922Z
updated_at: 2026-05-25T08:08:51.922Z
---

## Problem

KOTA's HTTP MCP client now supports the official MCP OAuth Client Credentials
extension for noninteractive remote MCP authorization, but the landed slice only
accepts `client_secret_basic`. The official extension also documents JWT bearer
assertions / `private_key_jwt` as the recommended credential format because the
client signs short-lived assertions instead of transmitting a long-lived client
secret.

That leaves operators who want safer machine-to-machine MCP access with two weak
choices: configure a shared client secret even when the authorization server
advertises `private_key_jwt`, or fall back to a static `Authorization` header.
Both bypass the stricter acquired-token path KOTA has been building for remote
MCP servers.

## Desired Outcome

KOTA's HTTP MCP client supports `private_key_jwt` as an explicit OAuth Client
Credentials token-endpoint authentication method. Operators can configure a
registered client id plus private signing key material through the existing
typed HTTP MCP authorization config boundary. When a protected MCP server and
authorization server advertise `private_key_jwt`, KOTA builds a short-lived JWT
client assertion with issuer, subject, audience, issued-at, expiration, and
unique id claims; exchanges it for a scoped Bearer token using
`grant_type=client_credentials`; binds the returned token to the MCP resource
and issuer; and retries the protected request with redacted diagnostics.

`client_secret_basic`, interactive authorization-code, and static-header modes
remain distinct and continue to work unchanged.

## Constraints

- Keep implementation in `src/core/mcp/`; the session loop consumes the
  external MCP client directly.
- Do not add a general JWT library unless it removes real local complexity.
  Node crypto signing with focused tests is acceptable if the code stays small
  and auditable.
- Treat signing key material as secret. It must not appear in prompts, thrown
  messages, console output, serialized config diagnostics, or run artifacts.
- Keep token-endpoint methods explicit. Do not silently retry
  `client_secret_basic` when `private_key_jwt` fails, and do not infer the
  method from whichever credential fields happen to be present.
- Validate authorization-server metadata before signing an assertion:
  `token_endpoint_auth_methods_supported` must include `private_key_jwt`, and
  configured scopes must be advertised when the server publishes
  `scopes_supported`.
- Use the authorization server token endpoint URL as the JWT audience and keep
  assertion lifetime short. Fail loudly on malformed signing config,
  unsupported algorithms, token endpoint errors, insufficient granted scope, or
  malformed token responses.
- Preserve the existing client-secret implementation and tests.

## Done When

- The HTTP MCP authorization config accepts a strict `private_key_jwt` client
  credentials mode and rejects malformed, mixed, or unsupported
  client-credentials configurations at load time.
- A protected HTTP MCP fixture can force a 401 challenge, serve protected-
  resource metadata, serve authorization-server metadata advertising
  `private_key_jwt`, verify the submitted JWT client assertion, receive
  `grant_type=client_credentials` with `resource` and `scope`, and observe the
  original MCP request retried with the scoped Bearer token.
- Negative tests cover unsupported token-endpoint auth methods, issuer/resource
  mismatch, missing or malformed private key material, unsupported signing
  algorithm, bad assertion audience or expiry, token endpoint failure,
  insufficient granted scope, expiry/reacquisition behavior, and redaction of
  private keys, assertions, client secrets, and tokens.
- Existing `client_secret_basic`, interactive authorization-code, static-header,
  MCP client, and MCP manager tests remain green.

## Source / Intent

Explorer run `2026-05-25T08-05-29-917Z-explorer-ks723u` reviewed a queue with
zero actionable ready/doing work. The strategic blocked alternatives exposed by
`inspect-queue` all still require operator-captured artifacts and were not
movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials`
  says the MCP OAuth Client Credentials extension supports both client secrets
  and JWT bearer assertions, recommends JWT assertions, requires extension
  capability negotiation, token refresh, scoped Bearer usage, and careful secret
  handling.
- `https://modelcontextprotocol.io/extensions/overview` says official
  extensions negotiate through `capabilities.extensions`, are disabled by
  default, and should either degrade explicitly or reject when mandatory.

Local evidence:

- `src/core/mcp/AGENTS.md` says the external MCP client and manager stay in
  core because the session loop consumes them directly.
- `src/core/mcp/client-auth-types.ts` currently narrows
  `McpOAuthClientCredentialsTokenEndpointAuthMethod` to `client_secret_basic`
  and requires a registered client secret for client-credentials mode.
- `src/core/mcp/client-authorization-protocol.ts` rejects any
  client-credentials `tokenEndpointAuthMethod` other than
  `client_secret_basic`.
- `src/core/mcp/client-oauth-token-runtime.ts` always sends
  `Authorization: Basic ...` in `runClientCredentialsFlow(...)`.
- Completed task `task-add-mcp-oauth-client-credentials-support-for-http-`
  intentionally allowed JWT auth as a follow-up if the first slice shipped
  `client_secret_basic` first.

## Initiative

MCP protocol fidelity and safe remote capability use: KOTA should consume
protected remote MCP servers through typed authorization modes instead of
forcing static token passthrough or weaker credential formats.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- A fake protected-resource / authorization-server fixture demonstrates
  `private_key_jwt` discovery, signed assertion exchange, scoped retry,
  unsupported-method failure, assertion validation failure, token reacquisition,
  and redaction without live external services.
- Config-decoder tests show `client_secret_basic`, `private_key_jwt`,
  interactive OAuth, and static headers are mutually explicit and cannot be
  mixed silently.
