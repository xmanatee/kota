---
id: task-security-review-remote-mcp-http-requests-call-the
title: Security review: Remote MCP HTTP requests call the host fetch implementation directly with configured headers and JSON-RPC bodies. Default redirect handling therefore bypasses KOTA's target validation, private-network protection, credential stripping, and cross-origin body-replay rejection, allowing a compromised MCP endpoint to redirect requests across trust boundaries.
status: ready
priority: p1
area: security
task_class: Safety
summary: Remote MCP HTTP requests call the host fetch implementation directly with configured headers and JSON-RPC bodies. Default redirect handling therefore bypasses KOTA's target validation, private-network protection, credential stripping, and cross-origin body-replay rejection, allowing a compromised MCP endpoint to redirect requests across trust boundaries.
created_at: 2026-08-15T04:06:48.889Z
updated_at: 2026-08-15T04:06:48.889Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/mcp/client-http-runtime.ts
claim:

> Remote MCP HTTP requests call the host fetch implementation directly with configured headers and JSON-RPC bodies. Default redirect handling therefore bypasses KOTA's target validation, private-network protection, credential stripping, and cross-origin body-replay rejection, allowing a compromised MCP endpoint to redirect requests across trust boundaries.

## Desired Outcome

> Route MCP transport, subscription, protected-resource, and OAuth HTTP calls through the shared OutboundHttpTransport using configured-provider or OAuth-specific profiles. Revalidate every redirect target, reject cross-origin body replay, strip unsafe headers, and add focused redirect/private-network tests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-15T01-40-48-994Z-security-review-wz3svj.

finding id: security-review-mcp-http-bypasses-outbound-policy
candidate id: auth-approval-boundary:src/core/mcp/manager.test.ts:559
verdict: confirmed
rationale:

> MCP requests and subscriptions call global fetch directly at src/core/mcp/client-http-runtime.ts:85 and :450; protected-resource and OAuth requests do likewise at client-protected-resource-runtime.ts:92 and client-oauth-token-runtime.ts:860. This enables automatic redirects without the per-hop target validation and cross-origin body-replay rejection implemented by outbound-http/transport.ts:159 and :222, permitting redirects outside selected origins, including private hosts, and replay of JSON or OAuth form bodies.

Evidence:

Evidence 1:



path: src/core/mcp/client-http-runtime.ts

line: 85

excerpt:



> const response = await fetch(transport.url, { method: "POST", headers: this.httpHeadersForRequest(method, requestParams), body: JSON.stringify(msg), signal: controller.signal });

Evidence 2:



path: src/core/mcp/client-http-runtime.ts

line: 143

excerpt:



> const headers = new Headers(this.transport.headers ?? {});

Evidence 3:



path: src/core/outbound-http/transport.ts

line: 159

excerpt:



> await abortable(validateOutboundHttpTarget(currentUrl, request.profile, this.#resolveAddresses), signal);

Evidence 4:



path: src/core/outbound-http/transport.ts

line: 222

excerpt:



> if (nextUrl.origin !== currentUrl.origin) { if (body != null || !CROSS_ORIGIN_SAFE_METHODS.has(method)) { throw this.#policyFailure(request, method, "redirect-denied", "cross-origin redirect would replay a request body or state-changing method", startedAt); } }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
