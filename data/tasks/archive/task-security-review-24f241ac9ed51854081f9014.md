---
status: done
---
# Security review: Authorization-code OAuth accepts the MCP peer's resource metadata without binding it to the configured MCP resource. A malicious peer can nominate another service's audience, cause KOTA to request a token for that service, and receive the resulting bearer token when KOTA retries the original peer. A controlled probe of the production HTTP and authorization runtime demonstrated this token delivery. PKCE, callback-state validation, and HTTPS endpoint checks do not prevent the audience mismatch.

security family: 24f241ac9ed51854081f9014ae58ff8b78484e9ca3d340531e3cc84a87f64953


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/mcp/client-authorization-runtime.ts
claim:

> Authorization-code OAuth accepts the MCP peer's resource metadata without binding it to the configured MCP resource. A malicious peer can nominate another service's audience, cause KOTA to request a token for that service, and receive the resulting bearer token when KOTA retries the original peer. A controlled probe of the production HTTP and authorization runtime demonstrated this token delivery. PKCE, callback-state validation, and HTTPS endpoint checks do not prevent the audience mismatch.

## Desired Outcome

> Bind authorization-code resource selection to the operator-authorized MCP resource and reject mismatching protected-resource metadata before authorization or token exchange. Preserve that binding through refresh and bearer dispatch. Endpoint TLS and network validation alone do not establish token audience ownership.

> Reject peer-selected audiences outside the trusted resource binding before requesting authorization, and verify that no resulting token reaches the peer. Retain valid same-resource authorization and refresh behavior. The run artifact oauth-resource-binding-probe.json records the synthetic counterexample; it does not establish a live issuer's grant policy.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-12T22-02-48-322Z-security-review-ijuovl.

Confirmed by security-review workflow runs:

- 2026-09-12T22-02-48-322Z-security-review-ijuovl

security evidence: 52257cc9599a4ac3463908d3e5fdeba3d1683ac3d1bcd38742e92ea3e67c85be
evidence identity: oauth-code-peer-selected-cross-resource-token-v1
production owner: src/core/mcp/client-authorization-runtime
violated invariant: oauth-audience-bound-to-authorized-resource
Common repair:
> Bind authorization-code resource selection to the operator-authorized MCP resource and reject mismatching protected-resource metadata before authorization or token exchange. Preserve that binding through refresh and bearer dispatch. Endpoint TLS and network validation alone do not establish token audience ownership.
Exploit preconditions:
> An attacker controls a configured MCP HTTP peer or its protected-resource metadata. Authorization-code OAuth and an authorization resolver are enabled; maintained interactive CLI paths supply such a resolver. The configured issuer must permit the client and user to obtain a token for another resource, and the user must complete authorization. These issuer and consent conditions were simulated, not established against a live deployment.
finding id: mcp-oauth-code-cross-resource-token-disclosure
candidate id: auth-approval-boundary:src/core/mcp/client-authorization-runtime.ts:1
verdict: confirmed
rationale:

> Authorization-code flow accepts resourceMetadata.resource without comparing it to the trusted MCP resource, passes it through authorization and token exchange, and sends the resulting token to transport.url. An independent production-runtime probe reproduced cross-resource token delivery with controlled HTTP and callback ports. Exploitation requires a controlled configured peer, an issuer permitting the other audience, and completed user authorization; live issuer policy was not verified. Binding resource selection before authorization and preserving it through refresh and dispatch addresses this invariant. The archived OAuth endpoint-policy repair concerns a distinct invariant and does not prevent this exploit; no matching predecessor evidence was found. Redaction did not prevent independent verification.

Evidence:

Evidence 1:



path: src/core/mcp/client-authorization-runtime.ts

line: 96

excerpt:



> : resourceMetadata.resource;

Evidence 2:



path: src/core/mcp/client-authorization-runtime.ts

line: 303

excerpt:



> authorizationUrl.searchParams.set("resource", resource);

Evidence 3:



path: src/core/mcp/client-authorization-runtime.ts

line: 412

excerpt:



> const form = new URLSearchParams({
>       grant_type: "authorization_code",
>       code,
>       redirect_uri: config.redirectUri,
>       client_id: client.clientId,
>       code_verifier: codeVerifier,
>       resource,
>       scope: scopes.join(" "),
>     });

Evidence 4:



path: src/core/mcp/client-http-runtime.ts

line: 149

excerpt:



> const token = this.oauthTokenBinding?.token.accessToken;
>     if (token) headers.set("Authorization", `Bearer ${token}`);

Evidence 5:



path: src/core/mcp/client-http-runtime.ts

line: 89

excerpt:



> url: transport.url,
>           method: "POST",
>           headers: this.httpHeadersForRequest(method, requestParams),


## Resolution

Authorization-code OAuth now uses the shared configured-resource metadata validator
before issuer discovery, client resolution, consent, or token exchange. The resource
must equal the normalized operator-configured MCP HTTP URL, including its path,
port, and query. Enterprise-managed authorization retains its explicit configured
resource. Interactive scope expansion remains supported.

The validated configured resource enters the existing token binding. Refresh uses
that binding's resource, and bearer requests use the client's fixed configured
transport. Every subsequent authorization challenge is validated again, so a peer
cannot replace the audience after a successful grant. No token persistence or
alternate token-installation path bypasses this owner.

## Verification

- Added public McpClient protocol regressions with controlled HTTP and callback
  ports. Before the fix, all five mismatched-resource connections succeeded;
  after the fix, different origins, sibling paths, child paths, ports, and queries
  reject before consent, issuer requests, token exchange, or bearer delivery.
- The positive journey checks URL normalization, requested consent scopes,
  authorization URL and token-form audiences, refresh-token reuse, refreshed
  bearer delivery to the configured peer, and rejection of later audience drift.
  Production discovery, authorization, refresh, and HTTP dispatch execute; only
  network, callback, and clock ports are controlled.
- `pnpm test:protocol src/core/mcp/`: 53 tests passed across six files, covering
  this regression plus existing client, endpoint, redirect, and redaction behavior.
- `pnpm check:fast`: passed production/test typechecking, lint, task validation,
  generated client bindings, and module admission.

These deterministic checks establish the client-side binding and compatibility.
No live issuer grants were exercised, and no claim is made about live issuer grant
policy. The original confirmed claim and synthetic evidence remain above.
