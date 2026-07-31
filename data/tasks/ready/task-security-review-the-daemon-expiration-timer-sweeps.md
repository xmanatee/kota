---
id: task-security-review-the-daemon-expiration-timer-sweeps
title: Security review: The daemon expiration timer sweeps only the singleton approval queue installed for the default project. Every non-default project owns a separate queue, so its pending tool approvals remain executable after their configured or default TTL. Approval mutation routes do not enforce expiry before preflight, allowing an old review receipt to execute a stale operation in a non-default scope.
status: ready
priority: p2
area: security
task_class: Safety
summary: The daemon expiration timer sweeps only the singleton approval queue installed for the default project. Every non-default project owns a separate queue, so its pending tool approvals remain executable after their configured or default TTL. Approval mutation routes do not enforce expiry before preflight, allowing an old review receipt to execute a stale operation in a non-default scope.
created_at: 2026-07-31T05:53:24.681Z
updated_at: 2026-07-31T05:53:24.681Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/daemon-subscriptions.ts
claim:

> The daemon expiration timer sweeps only the singleton approval queue installed for the default project. Every non-default project owns a separate queue, so its pending tool approvals remain executable after their configured or default TTL. Approval mutation routes do not enforce expiry before preflight, allowing an old review receipt to execute a stale operation in a non-default scope.

## Desired Outcome

> Sweep every ProjectRuntime approval queue independently and isolate failures by scope. Also enforce the approval deadline atomically in getExecutionSnapshot or approval mutation preflight so an expired record cannot execute between timer ticks or when a scope timer is absent. Add a two-project regression proving a non-default dangerous tool approval expires and cannot execute with its old review receipt.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-31T04-53-05-308Z-security-review-1x5imx.

finding id: finding-nondefault-project-approval-ttl-not-enforced
candidate id: auth-approval-boundary:src/core/daemon/daemon-subscriptions.ts:5
verdict: confirmed
rationale:

> createProjectRuntime constructs a distinct ApprovalQueue for every project and installs only the default project's queue as the singleton. daemon-subscriptions sweeps only getApprovalQueue(), so non-default queues are never periodically expired. Neither getExecutionSnapshot nor the approval mutation route checks createdAt, timeoutMs, or the configured default TTL before preflight and execution, leaving an overdue non-default approval executable.

Evidence:

Evidence 1:



path: src/core/daemon/daemon-subscriptions.ts

line: 66

excerpt:



> const approvalSweepTimer = setInterval(() => {
>   try {
>     const { blocked } = getApprovalQueue().expireStale(approvalTtlMs);

Evidence 2:



path: src/core/daemon/project-runtime.ts

line: 128

excerpt:



> const approvalQueue = new ApprovalQueue(join(projectDir, ".kota", "approvals"), pbus);
> ...
> if (opts.installSingletons) {
>   ...
>   setApprovalQueueInstance(approvalQueue);

Evidence 3:



path: src/core/daemon/daemon-startup.ts

line: 112

excerpt:



> ctx.unsubscribe = subscribeDaemon({
>   bus: ctx.bus,
>   failureAlertScopes: ctx.projectRuntimes.list().map((runtime) => ({
>     pbus: runtime.pbus,
>     projectDir: runtime.project.projectDir,
>   })),

Evidence 4:



path: src/modules/approval-queue/route-approval-execution.ts

line: 94

excerpt:



> const selection = queue.getExecutionSnapshot(id);
> ...
> const preflight = await prepareApprovalExecutionBatch([selection.snapshot], executionContext);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
