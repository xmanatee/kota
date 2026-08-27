---
status: done
---

# Security review: The authenticated daemon-control GET /workflow/runs/:id route accepts a decoded route parameter as a filesystem path segment. An id such as '..%2fsome-dir' is decoded before the handler sees it, then WorkflowRunStore.getRun joins it under runsDir without applying the existing path-safe run-id validation. This lets an authenticated client make the daemon attempt to read metadata.json outside the runs directory and can expose metadata-shaped files or produce route errors from malformed JSON.

## Problem

The security-review workflow confirmed an application-security finding.

severity: low
affected path: src/core/daemon/daemon-control-workflow.ts
claim:

> The authenticated daemon-control GET /workflow/runs/:id route accepts a decoded route parameter as a filesystem path segment. An id such as '..%2fsome-dir' is decoded before the handler sees it, then WorkflowRunStore.getRun joins it under runsDir without applying the existing path-safe run-id validation. This lets an authenticated client make the daemon attempt to read metadata.json outside the runs directory and can expose metadata-shaped files or produce route errors from malformed JSON.

## Desired Outcome

> Validate GET /workflow/runs/:id with validateWorkflowRunId before calling the run store, or make WorkflowRunStore.getRun reject invalid path segments internally. Add a regression covering encoded traversal such as /workflow/runs/..%2foutside returning 400 or 404 without reading outside .kota/runs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-07T00-47-50-619Z-security-review-lkh4o5.

finding id: security-review-run-id-path-traversal
candidate id: daemon-control-route:src/core/daemon/daemon-control-workflow.ts:1
verdict: confirmed
rationale:

> Confirmed. The route matcher decodes ..%2foutside to ../outside, handleGetWorkflowRun passes params.id through without validateWorkflowRunId, and WorkflowRunStore.getRun joins that id under runsDir. A temp-project probe showed getRun('../outside') reads .kota/outside/metadata.json outside the runs directory. The route is authenticated, so the impact remains an authenticated low-severity path traversal/read of metadata-shaped JSON or parse-error behavior.

Evidence:

Evidence 1:

path: src/core/daemon/daemon-control-routes.ts

line: 858

excerpt:

> GET /workflow/runs/:id is registered as a read control route and passes route params to handleGetWorkflowRun.

Evidence 2:

path: src/core/modules/route-matcher.ts

line: 57

excerpt:

> The matcher stores safeDecode(pathParts[i]) in params for :id segments, so encoded slashes become slash characters before handler validation.

Evidence 3:

path: src/core/daemon/daemon-control-workflow.ts

line: 54

excerpt:

> handleGetWorkflowRun calls handle.getWorkflowRun(params.id, scope.projectId) without checking that params.id is a path-safe run id.

Evidence 4:

path: src/core/workflow/run-store.ts

line: 231

excerpt:

> WorkflowRunStore.getRun reads join(this.runsDir, id, "metadata.json"), so a decoded slash or dot segment can move the lookup outside the intended run directory.

Evidence 5:

path: src/core/workflow/run-io.ts

line: 58

excerpt:

> validateWorkflowRunId already defines the path-safe run-id contract, but getRun and the daemon route do not use it.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Completion

Fixed `GET /workflow/runs/:id` by validating the decoded route `id` with
`validateWorkflowRunId` before calling `handle.getWorkflowRun`. Added a daemon
control regression for `/workflow/runs/..%2foutside` that returns 400 and
asserts the run lookup is not called.

Verification:

- `pnpm test src/core/daemon/daemon-control.test.ts`
- `pnpm exec biome check src/core/daemon/daemon-control-workflow.ts src/core/daemon/daemon-control.test.ts`
- `pnpm run typecheck`
- `pnpm run validate-tasks`
