---
id: task-security-review-approving-a-queued-tool-for-a-sele
title: Security review: Approving a queued tool for a selected non-default project resolves that project's approval queue, but then executes the approved tool without passing any project/session scope into executeTool. Relative-path or cwd-sensitive tools can therefore run against the daemon/default cwd instead of the project whose queue was approved.
status: done
priority: p2
area: security
summary: Approving a queued tool for a selected non-default project resolves that project's approval queue, but then executes the approved tool without passing any project/session scope into executeTool. Relative-path or cwd-sensitive tools can therefore run against the daemon/default cwd instead of the project whose queue was approved.
created_at: 2026-06-19T15:14:20.974Z
updated_at: 2026-06-19T15:30:34.969Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/routes.ts
claim: Approving a queued tool for a selected non-default project resolves that project's approval queue, but then executes the approved tool without passing any project/session scope into executeTool. Relative-path or cwd-sensitive tools can therefore run against the daemon/default cwd instead of the project whose queue was approved.

## Desired Outcome

Carry the resolved project runtime/scope into approval execution. Pass a ToolRunnerContext with projectId/scopeId/sessionId and execute relative-path tools under the selected project's directory, or route approved execution through the selected project runtime. Add regression coverage for single approve and approve-all using a relative-path tool in project B, asserting no write/read occurs in the default project.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-19T14-11-38-407Z-security-review-ywmv5c.

finding id: approval-project-scope-execution-missing-context
candidate id: auth-approval-boundary:src/modules/approval-queue/cli.ts:125
verdict: confirmed
rationale: The approval routes resolve the selected project's approvalQueue via projectId, but approvedApprovalResponse and approveAllResponse both execute through executeApprovedTool, which calls executeTool(item.tool, item.input) without any ToolRunnerContext. PendingApproval stores sessionId but no projectId/scopeId, and cwd/path-sensitive tools such as shell and file_write default to process cwd/raw paths, so a non-default project's queued approval can execute outside that project's runtime scope.

Evidence:

- src/modules/approval-queue/routes.ts:278 - const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
- src/modules/approval-queue/routes.ts:289 - jsonResponse(res, 200, await approvedApprovalResponse(result.approval));
- src/modules/approval-queue/routes.ts:145 - const result = await executeTool(item.tool, item.input);
- src/modules/approval-queue/routes.ts:457 - const queue = resolveApprovalQueue(res, undefined, readProjectId(req));
- src/modules/approval-queue/routes.ts:468 - jsonResponse(res, 200, await approvedApprovalResponse(result.approval));
- src/modules/filesystem/file-write.ts:45 - const existed = existsSync(path);
- src/modules/filesystem/file-write.ts:59 - writeFileSync(path, content, "utf-8");
- src/modules/approval-queue/daemon-control.test.ts:318 - expect(vi.mocked(executeTool)).toHaveBeenCalledWith(

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification: `pnpm exec vitest run src/modules/approval-queue/execution-scope.test.ts src/modules/approval-queue/routes.test.ts src/modules/approval-queue/daemon-control.test.ts src/modules/filesystem/file-write.test.ts src/modules/execution/shell.test.ts`, `pnpm typecheck`, and `pnpm validate-tasks` pass.
