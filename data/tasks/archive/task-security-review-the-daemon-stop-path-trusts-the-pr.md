---
status: done
---

# Security review: The daemon stop path trusts the project-local daemon-control.json pid and sends SIGTERM without first authenticating a live KOTA daemon, so tampered or stale project state can make the CLI terminate an unrelated same-user process.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/daemon-ops/daemon-ops-operations.ts
claim:

> The daemon stop path trusts the project-local daemon-control.json pid and sends SIGTERM without first authenticating a live KOTA daemon, so tampered or stale project state can make the CLI terminate an unrelated same-user process.

## Desired Outcome

> Change the local stop path to authenticate the control file endpoint and confirm `/status.pid` matches before signaling. If the endpoint is unreachable or unauthenticated, report stale/unavailable and refuse to kill the recorded pid.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-20T19-10-07-423Z-security-review-7y0nup.

finding id: daemon-stop-trusts-control-file-pid
candidate id: daemon-control-route:src/modules/daemon-ops/index.ts:1249
verdict: confirmed
rationale:

> Confirmed. The CLI stop command calls localDaemonStop directly in src/modules/daemon-ops/index.ts:1069. localDaemonStop reads the project-local .kota/daemon-control.json and passes address.pid to stopDaemonPid in src/modules/daemon-ops/daemon-ops-operations.ts:117-121. stopDaemonPid only checks isProcessAlive before process.kill(pid, "SIGTERM") at line 103, with no authenticated /status check or daemon identity match on this path.

Evidence:

Evidence 1:

path: src/modules/daemon-ops/index.ts

line: 1069

excerpt:

> const result = await localDaemonStop({ timeoutSec, projectDir });

Evidence 2:

path: src/modules/daemon-ops/daemon-ops-operations.ts

line: 68

excerpt:

> function readControlAddress(options: DaemonOpsProjectOptions = {}): DaemonControlAddress | null {

Evidence 3:

path: src/modules/daemon-ops/daemon-ops-operations.ts

line: 117

excerpt:

> const address = readControlAddress({ projectDir });

Evidence 4:

path: src/modules/daemon-ops/daemon-ops-operations.ts

line: 121

excerpt:

> : await stopDaemonPid(address.pid, timeoutSec);

Evidence 5:

path: src/modules/daemon-ops/daemon-ops-operations.ts

line: 103

excerpt:

> process.kill(pid, "SIGTERM");

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Resolution

The local daemon stop path now authenticates the control-file endpoint with the
published bearer token, reads `GET /status`, and confirms the reported pid
matches the control-file pid before sending `SIGTERM`. Unreachable,
unauthenticated, malformed, or pid-mismatched endpoints return
`reason: "unavailable"` and do not signal the recorded pid.

## Verification

- `pnpm exec vitest run src/modules/daemon-ops/daemon-ops-operations.test.ts src/modules/daemon-ops/daemon-ops-daemon-client.test.ts`
- `pnpm typecheck`
- `pnpm lint`
