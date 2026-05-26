---
id: task-security-review-the-daemon-bearer-token-is-written
title: Security review: The daemon bearer token is written into the project-local .kota directory, while ordinary safe file reads and allowed HTTP requests can combine to give an autonomous agent bearer access to daemon control and secret routes.
status: ready
priority: p1
area: security
summary: The daemon bearer token is written into the project-local .kota directory, while ordinary safe file reads and allowed HTTP requests can combine to give an autonomous agent bearer access to daemon control and secret routes.
created_at: 2026-05-26T19:58:42.648Z
updated_at: 2026-05-26T19:58:42.648Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/daemon-startup.ts
claim: The daemon bearer token is written into the project-local .kota directory, while ordinary safe file reads and allowed HTTP requests can combine to give an autonomous agent bearer access to daemon control and secret routes.

## Desired Outcome

Keep daemon-control credentials outside agent-readable project state or deny tool reads of .kota/daemon-control.json, and gate loopback/private-network web-access targets so ordinary agent tools cannot reuse the token against daemon control or secret routes.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T19-49-22-030Z-security-review-h4k45s.

finding id: security-review-daemon-control-token-agent-escalation
candidate id: daemon-control-route:src/core/daemon/client-identity.ts:7
verdict: confirmed
rationale: The daemon writes a bearer token into project-local runtime state, the filesystem read tool has safe read-only classification and no .kota denylist, and http_request accepts caller-supplied Authorization headers and loopback URLs. The daemon-control server uses only bearer equality for both built-in and module routes, and the secrets route returns raw secret values, so an autonomous agent that reads the control file can reuse the token against daemon API routes.

Evidence:

- src/core/daemon/daemon.ts:110 - config.stateDir ?? join(configuredProjects[0]!.projectDir, ".kota");
- src/core/daemon/daemon-startup.ts:61 - writeControlFile(ctx.stateDir, {
- src/core/daemon/daemon-startup.ts:65 - token: ctx.token,
- src/core/daemon/daemon-control-types.ts:60 - token: string;
- src/modules/filesystem/index.ts:33 - effect: readOnlyLocalEffect(),
- src/modules/web-access/http-request.ts:72 - const headers = (input.headers as Record<string, string>) || {};
- src/modules/web-access/http-request.ts:124 - response = await fetch(url, fetchOptions);
- src/core/daemon/daemon-control.ts:230 - return header === `Bearer ${this.token}`;
- src/modules/secrets/routes.ts:41 - jsonResponse(res, 200, { found: true, value });

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
