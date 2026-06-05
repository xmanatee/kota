---
id: task-security-review-unauthenticated-dashboard-entry-re
title: Security review: Unauthenticated dashboard entry requests can mint a cookie containing the daemon control token; that same cookie is accepted as control-route authentication, so any local HTTP client that discovers the daemon port can bypass the protected daemon-control file boundary when the dashboard route is present.
status: done
priority: p1
area: security
summary: Unauthenticated dashboard entry requests can mint a cookie containing the daemon control token; that same cookie is accepted as control-route authentication, so any local HTTP client that discovers the daemon port can bypass the protected daemon-control file boundary when the dashboard route is present.
created_at: 2026-06-05T21:00:10.462Z
updated_at: 2026-06-05T21:10:04.445Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/daemon-control.ts
claim: Unauthenticated dashboard entry requests can mint a cookie containing the daemon control token; that same cookie is accepted as control-route authentication, so any local HTTP client that discovers the daemon port can bypass the protected daemon-control file boundary when the dashboard route is present.

## Desired Outcome

Do not disclose the raw daemon token through an unauthenticated dashboard response. Require an existing bearer token or explicit one-time pairing flow before setting any dashboard session cookie, use a separate scoped UI session token if needed, and add regression coverage that unauthenticated GET / and /index.html never emit a token-bearing cookie while protected control routes still reject unauthenticated requests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-05T20-33-05-134Z-security-review-lmkme7.

finding id: sr-dashboard-cookie-token-bootstrap
candidate id: daemon-control-route:src/core/daemon/daemon-control-routes.ts:1
verdict: confirmed
rationale: Confirmed. `DaemonControlServer` accepts `kota_daemon_token` as control-route authentication, writes the raw daemon token into that cookie, and unauthenticated `GET /` or `/index.html` module-route requests take the dashboard-entry branch that sets the cookie before invoking the handler. The web module registers those dashboard entry routes without bypassAuth, so a local HTTP client that finds the daemon port can mint the cookie and reuse it against protected routes.

Evidence:

- src/core/daemon/daemon-control.ts:244 - return this.cookieValue(req, DASHBOARD_AUTH_COOKIE) === this.token;
- src/core/daemon/daemon-control.ts:266 - `${DASHBOARD_AUTH_COOKIE}=${encodeURIComponent(this.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
- src/core/daemon/daemon-control.ts:349 - if (dashboardEntry) {
- src/core/daemon/daemon-control.ts:350 - this.setDashboardAuthCookie(res);
- src/core/daemon/daemon-control.ts:351 - this.invokeRouteHandler(moduleMatch.route, req, res, moduleMatch.params);
- src/modules/web/static-routes.ts:114 - { method: "GET", path: "/", handler: (req, res) => serveIndex(req, res, options) },

## Result

`DaemonControlServer` no longer accepts or emits raw daemon-token dashboard cookies. Dashboard entry routes follow the same auth check as other module routes; unauthenticated `GET /` and `GET /index.html` return 401 without invoking the dashboard handler or setting a cookie. Bearer-authenticated dashboard entry requests mint a separate daemon-local `kota_dashboard_session` cookie whose value is not the daemon control token, and that cookie can authorize subsequent browser UI control requests.

Verification:

- `pnpm test src/core/daemon/daemon-control.test.ts`
- `pnpm typecheck`
- `pnpm lint`

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression coverage in `src/core/daemon/daemon-control.test.ts` rejects raw daemon-token cookies, verifies unauthenticated `/` and `/index.html` do not set cookies, verifies bearer-authenticated dashboard entry mints a separate session cookie, and verifies protected control routes still reject unauthenticated requests.
