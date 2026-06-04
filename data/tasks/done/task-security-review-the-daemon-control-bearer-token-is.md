---
id: task-security-review-the-daemon-control-bearer-token-is
title: Security review: The daemon control bearer token is written through the generic JSON writer without enforcing restrictive directory or file permissions, so a fresh state directory under a normal permissive umask can expose `.kota/daemon-control.json` to other local users who can then authorize loopback control requests.
status: done
priority: p2
area: security
summary: The daemon control bearer token is written through the generic JSON writer without enforcing restrictive directory or file permissions, so a fresh state directory under a normal permissive umask can expose `.kota/daemon-control.json` to other local users who can then authorize loopback control requests.
created_at: 2026-06-04T10:34:18.600Z
updated_at: 2026-06-04T10:38:12.739Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/daemon-instance-lock.ts
claim: The daemon control bearer token is written through the generic JSON writer without enforcing restrictive directory or file permissions, so a fresh state directory under a normal permissive umask can expose `.kota/daemon-control.json` to other local users who can then authorize loopback control requests.

## Desired Outcome

Write daemon-control.json with a dedicated secure path that creates/chmods the state directory to 0700 and the temp/final control file to 0600, then add a POSIX mode regression test for writeControlFile.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-04T08-50-47-847Z-security-review-doj5lc.

finding id: security-review-daemon-control-token-file-mode
candidate id: daemon-control-route:src/core/daemon/client-identity.ts:7
verdict: confirmed
rationale: Confirmed. The daemon generates a bearer token in src/core/daemon/daemon.ts:130, writes it into daemon-control.json from src/core/daemon/daemon-startup.ts:61-65, and writeControlFile delegates to writeJsonFileAtomic in src/core/daemon/daemon-instance-lock.ts:64-65. The generic writer creates the directory and temp file without explicit modes in src/core/util/json-file.ts:61-63, so a normal POSIX umask can leave the token file and directory world-readable while src/core/daemon/daemon-control.ts:232-235 accepts that token for bearer auth.

Evidence:

- src/core/daemon/daemon.ts:130 - const token = randomBytes(32).toString("hex");
- src/core/daemon/daemon-startup.ts:61 - writeControlFile(ctx.stateDir, {
- src/core/daemon/daemon-startup.ts:65 - token: ctx.token,
- src/core/daemon/daemon-instance-lock.ts:65 - writeJsonFileAtomic(join(stateDir, CONTROL_FILE), payload);
- src/core/util/json-file.ts:62 - writeFileSync(tmpPath, serialize(value), "utf-8");
- src/core/daemon/daemon-control.ts:235 - return header === `Bearer ${this.token}`;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/daemon/daemon-instance-lock.test.ts`
