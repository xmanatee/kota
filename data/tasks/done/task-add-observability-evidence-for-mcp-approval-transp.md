---
id: task-add-observability-evidence-for-mcp-approval-transp
title: Add observability evidence for MCP approval transport identity checks
status: done
priority: p2
area: core
task_class: Platform
summary: Builder run 2026-07-08T09-35-24-296Z-builder-7v5o50 fixed queued MCP approval transport identity pinning, but its observability-obligation diagnostic reported missing inspectable evidence for src/core/daemon/approval-queue.ts, src/core/tools/tool-runner-approval-queue.ts, src/core/tools/tool-runner-execute-block.ts, and src/core/tools/tool-runner-mcp.ts.
created_at: 2026-07-08T10:25:55.135Z
updated_at: 2026-07-08T10:37:32.613Z
---

## Problem

    Builder run 2026-07-08T09-35-24-296Z-builder-7v5o50 fixed queued MCP approval transport identity pinning, but its observability-obligation diagnostic reported missing inspectable evidence for src/core/daemon/approval-queue.ts, src/core/tools/tool-runner-approval-queue.ts, src/core/tools/tool-runner-execute-block.ts, and src/core/tools/tool-runner-mcp.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-08T09-55-37-918Z-progress-reviewer-29tjxq.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-08T09-55-37-918Z-progress-reviewer-29tjxq.

review verdict: needs-steering
review summary:

    Recent scoped work is producing committed fixes, with task balance Safety 7, Product 1, Platform 5, Meta 7 and no operator-journey risks. Steering is still needed because the MCP approval fix left an unresolved runtime-observability gap, and three builder dead letters remain open with an existing pending owner question.

Evidence ids:

- event:evtj-000000158780
- task:task-security-review-queued-mcp-approvals-only-pin-the-
- git:commit:bcf3e436f856

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A follow-up run artifact, focused test assertion, explicit error-result evidence, structured event/log evidence, or narrow waiver rationale maps each cited file to inspectable observability evidence for the MCP approval transport identity change; an observability-obligation recheck reports no unresolved missing files; focused approval/MCP tests and task validation pass.

- Resolution evidence:

    `.kota/runs/2026-07-08T10-26-11-408Z-builder-ofyijg/observability-obligation-recheck.json` replays source commit `bcf3e436f856` plus this follow-up's focused metadata assertion diff. The recheck reports `outcome: "ok"`, `missingFiles: []`, and maps `src/core/daemon/approval-queue.ts` to `src/core/daemon/approval-queue-mcp.test.ts`, plus `src/core/tools/tool-runner-approval-queue.ts`, `src/core/tools/tool-runner-execute-block.ts`, and `src/core/tools/tool-runner-mcp.ts` to `src/core/tools/tool-runner-mcp-approval.test.ts`.

    `src/modules/autonomy/observability-obligation.test.ts` includes the same MCP approval transport identity diagnostic scenario as a regression test. Focused validation passed with `pnpm test src/core/daemon/approval-queue-mcp.test.ts src/core/tools/tool-runner-mcp-approval.test.ts src/modules/approval-queue/routes-mcp-execution.test.ts src/modules/autonomy/observability-obligation.test.ts` (4 files, 21 tests) and `pnpm exec biome check src/core/daemon/approval-queue-mcp.test.ts src/core/tools/tool-runner-mcp-approval.test.ts src/modules/autonomy/observability-obligation.test.ts`.
