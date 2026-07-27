---
id: task-security-review-daemon-startup-does-not-acquire-an
title: Security review: Daemon startup does not acquire an exclusive filesystem reservation, and it treats any non-2xx health response as stale. A live but degraded daemon returns 503, causing its control file to be removed; concurrent startups can also both pass the missing-control-file check before either writes ownership. Both paths permit multiple autonomous daemons to operate on the same project.
status: done
priority: p1
area: security
task_class: Safety
summary: Daemon startup does not acquire an exclusive filesystem reservation, and it treats any non-2xx health response as stale. A live but degraded daemon returns 503, causing its control file to be removed; concurrent startups can also both pass the missing-control-file check before either writes ownership. Both paths permit multiple autonomous daemons to operate on the same project.
created_at: 2026-07-27T03:25:52.656Z
updated_at: 2026-07-27T04:06:13.133Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/daemon-instance-lock.ts
claim:

> Daemon startup does not acquire an exclusive filesystem reservation, and it treats any non-2xx health response as stale. A live but degraded daemon returns 503, causing its control file to be removed; concurrent startups can also both pass the missing-control-file check before either writes ownership. Both paths permit multiple autonomous daemons to operate on the same project.

## Desired Outcome

> Acquire an atomic exclusive lock before asynchronous startup, retain it for the daemon lifetime, and authenticate ownership checks using the stored token and process identity. Do not evict a confirmed live owner solely because health reports degradation. Add simultaneous-start and degraded-503 regression tests.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-27T02-48-33-344Z-security-review-s3q44o.

finding id: daemon-instance-lock-nonexclusive-degraded-health
candidate id: external-fetch:src/core/daemon/daemon-instance-lock.ts:56
verdict: confirmed
rationale:

> Confirmed in narrowed form. Commit 4fbdcf474 fixed the degraded-health path: a live owner returning non-2xx is now preserved and startup throws. The simultaneous-start vulnerability remains because acquireInstanceLock returns when the control file is absent, while ownership is written only after asynchronous server startup. A current-head probe showed two acquisitions both fulfilling and the second control-file write replacing the first owner.

Evidence:

Evidence 1:



path: src/core/daemon/daemon-instance-lock.ts

line: 41

excerpt:



> if (!control) return;

Evidence 2:



path: src/core/daemon/daemon-instance-lock.ts

line: 56

excerpt:



> const res = await fetch(`http://127.0.0.1:${port}/health`, {

Evidence 3:



path: src/core/daemon/daemon-instance-lock.ts

line: 59

excerpt:



> if (res.ok) {

Evidence 4:



path: src/core/daemon/daemon-instance-lock.ts

line: 75

excerpt:



> log(`Control file references pid ${pid} (alive) but has no port — removing stale control file`);

Evidence 5:



path: src/core/daemon/daemon-control-routes.ts

line: 408

excerpt:



> jsonResponse(res, degraded ? 503 : 200, {

Evidence 6:



path: src/core/daemon/daemon-startup.ts

line: 57

excerpt:



> await acquireInstanceLock(ctx.projectDir, ctx.stateDir, ctx.log);

Evidence 7:



path: src/core/daemon/daemon-startup.ts

line: 65

excerpt:



> const controlPort = await ctx.controlServer.start();

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `src/core/daemon/daemon-instance-lock.ts` now reserves
  `.kota/daemon-instance.lock` atomically before asynchronous startup, keeps
  the reservation for the daemon lifetime, and removes ownership files only
  when PID, start time, and token all match the stopping daemon.
- Existing live owners are authenticated through `GET /identity` using the
  control-file bearer token. Unreachable, malformed, mismatched, and non-2xx
  responses preserve the live owner's files and reject the contender.
- `pnpm exec vitest run src/core/daemon/daemon-instance-lock.test.ts
  src/modules/autonomy/critic-runtime-probe-artifact.test.ts` passed 14 tests,
  including simultaneous startup, degraded 503, authenticated identity, and
  owner-matched teardown regressions.
- `pnpm build` completed successfully on 2026-07-27.
