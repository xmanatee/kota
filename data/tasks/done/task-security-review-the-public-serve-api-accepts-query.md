---
id: task-security-review-the-public-serve-api-accepts-query
title: Security review: The public serve API accepts query-string token authentication for state-changing approval routes, so a leaked dashboard URL token is sufficient to trigger approve-all through a simple POST to the loopback server without an Authorization header.
status: done
priority: p2
area: security
summary: The public serve API accepted query-string token authentication for state-changing approval routes; non-GET serve API requests now require the bearer Authorization header while GET query-token bootstrap/read routes remain available.
created_at: 2026-06-24T01:25:51.008Z
updated_at: 2026-06-24T01:35:05.816Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/server/server-routes.ts
claim:

> The public serve API accepts query-string token authentication for state-changing approval routes, so a leaked dashboard URL token is sufficient to trigger approve-all through a simple POST to the loopback server without an Authorization header.

## Desired Outcome

> Limit query-token authentication to safe bootstrap or GET-only API use. Require the Authorization header, and preferably the existing dashboard-request guard or same-origin check, for non-GET approval mutations. Add a regression test that POST /api/approvals/approve-all?token=... is rejected without the protected header path.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Resolution

The public `kota serve` `/api/*` auth gate now accepts query-string token
authentication only for `GET` requests. Non-GET requests, including
`POST /api/approvals/approve-all?token=...`, must authenticate with the
`Authorization: Bearer ...` header unless the matched module route explicitly
declares `bypassAuth`.

## Source / Intent

Created by security-review workflow run 2026-06-23T23-50-26-713Z-security-review-p5omzc.

finding id: serve-query-token-approval-mutation
candidate id: daemon-control-route:src/modules/approval-queue/route-registrations.ts:48
verdict: confirmed
rationale:

> Confirmed. src/core/server/server.ts:183-185 publishes the serve dashboard URL with the raw token in the query string, and src/core/server/server-routes.ts:81-88 accepts that query token for every non-bypass /api/* route without checking the HTTP method. The approval module registers POST /api/approvals/approve-all at src/modules/approval-queue/route-registrations.ts:47-58, and the handler forwards or executes the approve-all mutation at src/modules/approval-queue/route-handlers.ts:116-135. The serve surface also emits permissive CORS headers in src/core/server/session-pool.ts:156-164, so a known query token is sufficient to authenticate a state-changing approval request without an Authorization header.

Evidence:

Evidence 1:



path: src/core/server/server.ts

line: 184

excerpt:



> ? `http://${LOOPBACK_HOST}:${actualPort}/?token=${authToken}`

Evidence 2:



path: src/core/server/server-routes.ts

line: 86

excerpt:



> const queryToken = url.searchParams.get("token");

Evidence 3:



path: src/core/server/server-routes.ts

line: 87

excerpt:



> if (header !== `Bearer ${ctx.authToken}` && queryToken !== ctx.authToken) {

Evidence 4:



path: src/modules/approval-queue/route-registrations.ts

line: 48

excerpt:



> path: "/api/approvals/approve-all",

Evidence 5:



path: src/modules/approval-queue/route-handlers.ts

line: 123

excerpt:



> `/approvals/approve-all${projectQuery(projectId)}`,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/core/server/server-routes.test.ts` passed on 2026-06-24; coverage includes rejected query-token `POST /api/approvals/approve-all?token=...`, accepted bearer POST, and retained GET query-token auth.
- `pnpm run typecheck` passed on 2026-06-24.
