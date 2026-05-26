---
id: task-security-review-the-daemon-control-get-apievents-r
title: Security review: The daemon-control `GET /api/events` route treats the authenticated `type` query parameter as a glob by replacing only `.` and `*` before passing it to `new RegExp`. Other regex metacharacters remain active, so a request such as `/api/events?type=*%5B` throws a synchronous `SyntaxError`. `DaemonControlServer` invokes route handlers before attaching `.catch`, so this exception escapes the route error path and can interrupt the daemon process under default Node uncaught-exception behavior.
status: done
priority: p2
area: security
summary: The daemon-control `GET /api/events` route treats the authenticated `type` query parameter as a glob by replacing only `.` and `*` before passing it to `new RegExp`. Other regex metacharacters remain active, so a request such as `/api/events?type=*%5B` throws a synchronous `SyntaxError`. `DaemonControlServer` invokes route handlers before attaching `.catch`, so this exception escapes the route error path and can interrupt the daemon process under default Node uncaught-exception behavior.
created_at: 2026-05-26T06:50:29.170Z
updated_at: 2026-05-26T06:59:37.767Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/daemon-control-routes.ts
claim: The daemon-control `GET /api/events` route treats the authenticated `type` query parameter as a glob by replacing only `.` and `*` before passing it to `new RegExp`. Other regex metacharacters remain active, so a request such as `/api/events?type=*%5B` throws a synchronous `SyntaxError`. `DaemonControlServer` invokes route handlers before attaching `.catch`, so this exception escapes the route error path and can interrupt the daemon process under default Node uncaught-exception behavior.

## Desired Outcome

Escape every regex metacharacter before expanding the intended `*` glob, or avoid regex construction for event-type filtering. Also wrap route handler invocation so synchronous throws become 500 responses instead of escaping the request handler. Add a regression test for a malformed glob such as `type=*%5B`.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-26T06-42-31-313Z-security-review-ftbb9c.

finding id: daemon-events-type-glob-regex-dos
candidate id: daemon-control-route:src/core/daemon/daemon-control-routes.ts:1
verdict: confirmed
rationale: The route builds a RegExp from the authenticated `type` query when it contains `*`, but only escapes dots before expanding stars, leaving `[` and other metacharacters active. A direct probe of the exact transform for `*[` produced `SyntaxError: Invalid regular expression`. The request listener calls `this.handleRequest` without an outer try/catch, and `handleRequest` evaluates `controlMatch.route.handler(...)` before `Promise.resolve(...).catch`, so this synchronous RegExp construction error is not converted into the intended 500 response path.

Evidence:

- src/core/daemon/daemon-control-routes.ts:239 - if (typeParam) {
- src/core/daemon/daemon-control-routes.ts:242 - const re = new RegExp(`^${typeParam.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
- src/core/daemon/daemon-control.ts:260 - Promise.resolve(controlMatch.route.handler(req, res, controlMatch.params)).catch((err: Error) => {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/daemon/daemon-control.test.ts` — 84 tests passed.
- `pnpm exec biome check src/core/daemon/daemon-control.ts src/core/daemon/daemon-control-routes.ts src/core/daemon/daemon-control.test.ts` — passed.
- `pnpm run typecheck` — passed.
- `pnpm run validate-tasks` — passed.
