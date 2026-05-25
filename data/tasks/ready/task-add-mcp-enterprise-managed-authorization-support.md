---
id: task-add-mcp-enterprise-managed-authorization-support
title: Add MCP enterprise-managed authorization support
status: ready
priority: p2
area: core
summary: Let KOTA's HTTP MCP client support the official MCP Enterprise-Managed Authorization extension with explicit IdP configuration, ID-JAG exchange, scoped token binding, and redacted diagnostics.
created_at: 2026-05-25T08:55:10.728Z
updated_at: 2026-05-25T08:55:10.728Z
---

## Problem

KOTA's HTTP MCP client now supports interactive OAuth and the official OAuth
Client Credentials extension, including `client_secret_basic` and
`private_key_jwt`. Those paths cover user-approved browser redirects and
service-owned machine-to-machine tokens, but they do not cover the new official
MCP Enterprise-Managed Authorization extension.

Enterprise-managed authorization is a different flow: the enterprise IdP acts
as the policy authority, the MCP client exchanges an existing SSO identity
assertion for an Identity Assertion JWT Authorization Grant, and the MCP
authorization server exchanges that ID-JAG for the MCP access token. Without an
explicit mode for this, KOTA operators connecting to enterprise-managed remote
MCP servers must either fall back to static bearer headers or misuse the
interactive authorization-code path.

## Desired Outcome

KOTA's HTTP MCP client supports the official Enterprise-Managed Authorization
extension as an explicit authorization mode for protected remote MCP servers.
Operators can configure the enterprise IdP token endpoint, subject-token source,
subject-token type, authorization-server issuer, MCP resource, scopes, and
registered MCP client credentials through the existing typed HTTP MCP
configuration boundary.

When a protected MCP server and configured authorization server require the
enterprise-managed extension, KOTA advertises extension support during
initialize, exchanges the configured identity assertion with the enterprise IdP
for an ID-JAG using OAuth token exchange, exchanges that ID-JAG with the MCP
authorization server using `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
binds the returned Bearer token to the MCP resource, issuer, scopes, and client
identity, then retries the protected request with redacted diagnostics.

Interactive OAuth, OAuth client credentials, and static-header authorization
remain separate explicit modes.

## Constraints

- Keep the external MCP client implementation in `src/core/mcp/`; the first-
  party MCP server module must not become a dependency of the client runtime.
- Do not infer enterprise-managed authorization from generic OAuth fields or
  silently fall back to another grant type. The config and runtime path must
  have a strict discriminator.
- Treat identity assertions, ID-JAGs, access tokens, refresh tokens, client
  secrets, private keys, and authorization headers as secrets. They must not
  appear in prompts, thrown messages, console output, serialized config
  diagnostics, tests snapshots, or run artifacts.
- Validate protected-resource metadata, authorization-server metadata, IdP
  token-exchange responses, ID-JAG token type, requested/granted scopes, issuer,
  resource, audience, client id, expiry, and token response shape before using
  the acquired token.
- Reuse the existing OAuth metadata discovery, token binding, scope validation,
  private-key JWT client-auth, and redaction helpers where they fit; do not add
  a parallel authorization stack.
- Model the subject-token source as an explicit boundary. Test fixtures may
  provide deterministic fake assertions, but production code should not add
  test-only hooks.

## Done When

- The HTTP MCP server config accepts a strict enterprise-managed authorization
  mode and rejects malformed or mixed enterprise/interactive/client-
  credentials/static-header configurations at load time.
- The MCP client advertises
  `io.modelcontextprotocol/enterprise-managed-authorization` only for that
  explicit mode and keeps the OAuth Client Credentials extension advertisement
  unchanged.
- A fake protected-resource / enterprise IdP / MCP authorization-server fixture
  can force a 401 challenge, serve protected-resource metadata, accept an OAuth
  token-exchange request with `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`,
  `resource`, `audience`, `scope`, `subject_token`, and
  `subject_token_type`, return an ID-JAG, accept the JWT bearer grant at the MCP
  authorization server, and observe the original MCP request retried with the
  scoped Bearer token.
- Negative tests cover unsupported extension negotiation, issuer/resource
  mismatch, unsupported subject-token type, missing or malformed IdP metadata or
  token response, ID-JAG token-type mismatch, bad JWT bearer grant response,
  insufficient granted scope, expired token reacquisition, and redaction of all
  identity assertions, grants, credentials, and tokens.
- Existing interactive OAuth, OAuth client credentials, `private_key_jwt`,
  static-header, MCP client, and MCP manager tests remain green.

## Source / Intent

Explorer run `2026-05-25T08-53-28-391Z-explorer-0vj8j1` reviewed a queue with
zero actionable ready/doing tasks. The strategic blocked alternatives exposed
by `inspect-queue` all still require operator-captured artifacts and were not
movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization`
  describes the official MCP extension for centralized enterprise IdP policy,
  client capability declaration, SSO identity assertions, ID-JAG handling,
  organization-level IdP configuration, scope handling, and authorization-server
  validation.
- `https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/draft/enterprise-managed-authorization.mdx`
  gives the draft technical profile: SSO to the MCP client, OAuth token
  exchange at the enterprise IdP to obtain an ID-JAG, JWT bearer grant at the
  MCP authorization server, required token-exchange parameters, ID-JAG claims,
  and validation rules for audience, resource, client id, expiry, and scope.

Local evidence:

- `src/core/mcp/AGENTS.md` says the external MCP client and manager stay in
  core because the session loop consumes them directly.
- `src/core/mcp/client-base.ts` currently advertises only the OAuth Client
  Credentials extension, and only when the HTTP transport authorization mode is
  `oauth-client-credentials`.
- `src/core/mcp/client-auth-types.ts` models interactive OAuth and OAuth client
  credentials, but has no enterprise-managed authorization discriminator or
  subject-token source.
- `src/core/mcp/client-oauth-token-runtime.ts` has reusable OAuth metadata,
  client resolution, scope validation, and token binding logic, but no IdP
  token-exchange step or JWT bearer grant path for ID-JAG.

## Initiative

MCP protocol fidelity and safe enterprise remote capability use: KOTA should
consume protected remote MCP servers through typed authorization modes instead
of forcing static token passthrough or an incorrect interactive OAuth flow.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/core/mcp/client.test.ts src/core/mcp/manager.test.ts`.
- Config-decoder tests show enterprise-managed, interactive OAuth, OAuth client
  credentials, and static headers are mutually explicit and cannot be mixed
  silently.
- A fake protected-resource / IdP / authorization-server fixture demonstrates
  extension advertisement, ID-JAG token exchange, JWT bearer access-token
  exchange, scoped retry, unsupported-extension failure, token reacquisition,
  and redaction without live external services.
