---
status: done
---

# Security review: The dashboard session cookie is treated as equivalent to the bearer token for every daemon-control and module route, including control-scope POST routes. Cookie-authenticated control requests have no Origin or CSRF check, so replay of the dashboard cookie can mutate daemon state without the bearer token.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/daemon-control.ts
claim: The dashboard session cookie is treated as equivalent to the bearer token for every daemon-control and module route, including control-scope POST routes. Cookie-authenticated control requests have no Origin or CSRF check, so replay of the dashboard cookie can mutate daemon state without the bearer token.

## Desired Outcome

Separate dashboard cookie auth from bearer-token API auth. Require bearer auth or a dashboard-origin CSRF/header check for cookie-authenticated non-GET and control-scope routes, and add regression tests proving dashboard cookies cannot call `/workflow/pause`, `/workflow/resume`, `/workflow/abort`, `/workflow/reload`, or `/reload` without the required browser-origin guard.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-13T02-46-13-638Z-security-review-007t2p.

finding id: security-review-dashboard-cookie-control-auth
candidate id: daemon-control-route:src/core/daemon/daemon-control-routes.ts:1
verdict: confirmed
rationale: DaemonControlServer.isAuthorized accepts either the bearer token or kota_dashboard_session cookie (src/core/daemon/daemon-control.ts:249-253), and handleRequest applies that same predicate to matched control routes before invoking them (src/core/daemon/daemon-control.ts:341-350). Mutating control routes including POST /workflow/pause, /workflow/resume, /workflow/abort, /workflow/reload, and /reload are registered as control routes (src/core/daemon/daemon-control-routes.ts:873-901). No separate Origin, Referer, Sec-Fetch, or CSRF-token check exists in the daemon-control auth path; SameSite=Strict on cookie minting is a browser mitigation, not a route-level guard.

Evidence:

- src/core/daemon/daemon-control.ts:253 - return this.cookieValue(req, DASHBOARD_SESSION_COOKIE) === this.dashboardSessionToken;
- src/core/daemon/daemon-control.ts:275 - `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(this.dashboardSessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
- src/core/daemon/daemon-control.ts:341 - const controlMatch = findRouteMatch(this.controlRoutes, method, path);
- src/core/daemon/daemon-control.ts:343 - if (!controlMatch.route.bypassAuth && !this.isAuthorized(req)) {
- src/core/daemon/daemon-control-routes.ts:874 - method: "POST",
- src/core/daemon/daemon-control-routes.ts:875 - path: "/workflow/pause",
- src/core/daemon/daemon-control-routes.ts:899 - path: "/reload",

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression tests in `src/core/daemon/daemon-control.test.ts` reject a bare dashboard session cookie on `POST /workflow/pause`, `/workflow/resume`, `/workflow/abort`, `/workflow/reload`, and `/reload`, and assert the mutating handlers are not invoked.
- Regression test in `src/core/daemon/daemon-control.test.ts` rejects a bare dashboard session cookie on an unsafe module route.
- Web client regression test in `clients/web/src/api/client.test.ts` proves mutating dashboard API calls include `X-Kota-Dashboard-Request: 1`.
- Verification commands: `pnpm test src/core/daemon/daemon-control.test.ts`; `(cd clients/web && pnpm test src/api/client.test.ts)`; `pnpm run typecheck`; `pnpm run lint`; `(cd clients/web && pnpm run typecheck)`; `(cd clients/web && pnpm run lint)`.

## Result

Daemon-control authentication now records whether a request was authorized by bearer token, dashboard cookie, or open/no-auth mode. Cookie-authenticated non-GET requests and control-scope routes require a same-origin/header dashboard request guard before the handler runs. Bearer-token requests remain accepted on the existing control routes. The embedded web client adds the dashboard request marker through its shared API wrapper for mutating requests.
