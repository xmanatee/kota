---
status: open
priority: p2
---
# Security review: The Jira provider accepts an arbitrary HTTP(S) base URL from configuration or an environment reference and sends the Jira email and API token to that origin using Basic authentication. An attacker who can influence that value can redirect credentials to a non-Atlassian or plaintext HTTP endpoint.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/jira/index.ts
claim:

> The Jira provider accepts an arbitrary HTTP(S) base URL from configuration or an environment reference and sends the Jira email and API token to that origin using Basic authentication. An attacker who can influence that value can redirect credentials to a non-Atlassian or plaintext HTTP endpoint.

## Desired Outcome

> Validate the resolved Jira base URL before constructing credentials or making requests: require HTTPS, require a hostname ending in .atlassian.net, and reject URL credentials or unexpected path/query/fragment components. Add boundary tests proving HTTP and non-Atlassian destinations are rejected before transport invocation.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-08-28T19-50-19-964Z-security-review-81h53j.

Confirmed by security-review workflow runs:

- 2026-08-28T19-50-19-964Z-security-review-81h53j

finding id: SEC-JIRA-CONFIGURABLE-CREDENTIAL-DESTINATION
candidate id: auth-approval-boundary:src/modules/jira/index.ts:69
verdict: confirmed
rationale:

> The Jira module sends Basic credentials to the resolved baseUrl without enforcing its documented Jira Cloud boundary. The configured-provider profile permits both HTTP and HTTPS and only checks the request against the same caller-selected origin, so arbitrary, plaintext, private-network, and non-Atlassian destinations remain accepted.

Evidence:

Evidence 1:



path: src/modules/jira/index.ts

line: 106

excerpt:



> const apiToken = resolveSecret(config.apiToken);
> const userEmail = resolveSecret(config.userEmail);
> const baseUrl = resolveSecret(config.baseUrl).replace(/\/$/, "");

Evidence 2:



path: src/modules/jira/index.ts

line: 63

excerpt:



> const { response: res } = await outboundHttp.request({
>   profile: OUTBOUND_HTTP_PROFILES.configuredProvider([baseUrl]),
>   url: `${baseUrl}${path}`,
>   headers: {
>     Authorization: `Basic ${credentials}`,

Evidence 3:



path: src/core/outbound-http/profiles.ts

line: 99

excerpt:



> if (url.protocol !== "http:" && url.protocol !== "https:") {
>   throw new TypeError(`${purpose} must use http:// or https://`);
> }

Evidence 4:



path: src/core/outbound-http/network-policy.ts

line: 35

excerpt:



> case "configured-provider":
>   if (!profile.allowedOrigins.includes(url.origin)) {
>     throw new OutboundHttpTargetPolicyError(...);
>   }
>   return;
