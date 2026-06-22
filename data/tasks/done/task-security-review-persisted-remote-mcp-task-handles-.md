---
id: task-security-review-persisted-remote-mcp-task-handles-
title: Security review: Persisted remote MCP task handles store the declaration fingerprint captured at task creation, but resume only checks server identity and task support before polling the task. When a current tool with the same name exists, entryForPersistedRemoteTask returns that current entry without comparing handle.toolDeclarationFingerprint to entry.declaration.fingerprint, so a task created under one advertised schema or description can be resumed and schema-validated under a changed declaration after restart with no mismatch diagnostic.
status: done
priority: p2
area: security
summary: Persisted remote MCP task handles store the declaration fingerprint captured at task creation, but resume only checks server identity and task support before polling the task. When a current tool with the same name exists, entryForPersistedRemoteTask returns that current entry without comparing handle.toolDeclarationFingerprint to entry.declaration.fingerprint, so a task created under one advertised schema or description can be resumed and schema-validated under a changed declaration after restart with no mismatch diagnostic.
created_at: 2026-06-22T16:47:12.480Z
updated_at: 2026-06-22T17:26:33Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/manager.ts
claim:

> Persisted remote MCP task handles store the declaration fingerprint captured at task creation, but resume only checks server identity and task support before polling the task. When a current tool with the same name exists, entryForPersistedRemoteTask returns that current entry without comparing handle.toolDeclarationFingerprint to entry.declaration.fingerprint, so a task created under one advertised schema or description can be resumed and schema-validated under a changed declaration after restart with no mismatch diagnostic.

## Desired Outcome

> During remote task resume, compare any persisted toolDeclarationFingerprint with the current same-name tool declaration. If it differs, leave the task handle as a diagnostic or resume with explicit mismatch metadata and avoid validating the result against the new declaration without an auditable warning and focused test.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Source Size Exception

kind: source-size-cleanup
files:
- src/core/mcp/manager.ts

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T16-27-44-599Z-security-review-jhfyyc.

finding id: mcp-remote-task-resume-ignores-declaration-fingerprint
candidate id: mcp-transport:src/core/mcp/manager.ts:336
verdict: confirmed
rationale:

> Persisted remote task handles still carry toolDeclarationFingerprint, but entryForPersistedRemoteTask returns a current same-name tool entry before comparing it with the handle fingerprint. The resumed polling path then calls toToolResult with that current entry, and toToolResult validates structured output against entry.tool. The persisted fingerprint is only retained in task diagnostics, so declaration drift across restart is not rejected or explicitly surfaced as a mismatch.

Evidence:

Evidence 1:



path: src/core/mcp/manager.ts

line: 1534

excerpt:



> toToolResult(entry, decoded),

Evidence 2:



path: src/core/mcp/manager.ts

line: 1636

excerpt:



> toolDeclarationFingerprint: stats.toolDeclarationFingerprint,

Evidence 3:



path: src/core/mcp/manager.ts

line: 1683

excerpt:



> if (currentIdentity.fingerprint !== handle.serverFingerprint) {

Evidence 4:



path: src/core/mcp/manager.ts

line: 1707

excerpt:



> const entry = this.entryForPersistedRemoteTask(handle, client);

Evidence 5:



path: src/core/mcp/manager.ts

line: 1742

excerpt:



> if (currentEntry) return currentEntry;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Completion Evidence

- Remote MCP task resume now compares a persisted
  `toolDeclarationFingerprint` with the current same-name tool declaration
  before polling or validating the resumed task result; mismatches preserve
  the handle with a diagnostic containing both fingerprints.
- Existing remote-task result and resume-formatting helpers were extracted to
  `src/core/mcp/remote-task-results.ts`, reducing
  `src/core/mcp/manager.ts` while keeping the security fix at the resume
  boundary.
- Regression coverage added in
  `src/core/mcp/manager-declaration-task-fingerprint.test.ts`.
- Verification passed: `pnpm test src/core/mcp/manager-declaration-task-fingerprint.test.ts`,
  `pnpm run typecheck`, `pnpm run lint`, `pnpm run validate-tasks`,
  staged source-size severe check, and `git diff --cached --check`.
