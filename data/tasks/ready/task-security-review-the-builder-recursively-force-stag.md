---
id: task-security-review-the-builder-recursively-force-stag
title: Security review: The builder recursively force-stages every file in its agent-writable run directory without an artifact allowlist, content redaction, secret screening, or size bounds. Ignored transcripts, credential dumps, environment files, or other runtime-only data can therefore enter durable Git history. In serial mode this path aliases the canonical workflow run directory, also sweeping active prompt, event, and step artifacts into the commit.
status: ready
priority: p1
area: security
task_class: Safety
summary: The builder recursively force-stages every file in its agent-writable run directory without an artifact allowlist, content redaction, secret screening, or size bounds. Ignored transcripts, credential dumps, environment files, or other runtime-only data can therefore enter durable Git history. In serial mode this path aliases the canonical workflow run directory, also sweeping active prompt, event, and step artifacts into the commit.
created_at: 2026-07-28T05:38:12.035Z
updated_at: 2026-07-28T05:38:12.035Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/builder/agent-run-artifacts.ts
claim:

> The builder recursively force-stages every file in its agent-writable run directory without an artifact allowlist, content redaction, secret screening, or size bounds. Ignored transcripts, credential dumps, environment files, or other runtime-only data can therefore enter durable Git history. In serial mode this path aliases the canonical workflow run directory, also sweeping active prompt, event, and step artifacts into the commit.

## Desired Outcome

> Use a separate evidence directory and commit only explicitly registered, typed artifacts after evidence projection or secret screening and file-count/size limits. Never force-add the canonical workflow run store. Add worktree and serial-mode tests proving that an unexpected ignored secret-shaped file and runtime step artifacts remain untracked.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T04-53-22-834Z-security-review-sixhkj.

finding id: finding-builder-unbounded-run-evidence-commit
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/builder/agent-run-artifacts.ts:5
verdict: confirmed
rationale:

> agent-run-artifacts.ts:21-33 recursively accepts every regular file without an allowlist, redaction, secret screening, or size bounds; lines 85-88 force-stage the entire ignored directory. commit.ts:180-203 implements this as `git add --force -A` and commit.ts:300-330 includes those newly staged paths in the path-limited commit. runtime-resources.ts:81-85 aliases agentRunDir to the canonical workflow run directory when worktree mode is disabled, while active-run-handle.ts:141-173 stores prompts, events, and step results there. The existing test verifies broad ignored-directory inclusion but does not prove unexpected sensitive or oversized files remain excluded.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/builder/agent-run-artifacts.ts

line: 21

excerpt:



> function listRegularFiles(directory: string): string[] {
>   const paths: string[] = [];
>   for (const entry of readdirSync(directory, { withFileTypes: true })) {

Evidence 2:



path: src/modules/autonomy/workflows/builder/agent-run-artifacts.ts

line: 85

excerpt:



> const artifacts = inspectAgentRunArtifacts(agentRunDir, workspaceDir);
> stageWorkflowPaths(workspaceDir, [artifacts.relativeRunDir], {
>   includeIgnored: true,
> });

Evidence 3:



path: src/modules/autonomy/commit.ts

line: 187

excerpt:



> execFileSync(
>   "git",
>   ["add", ...(options.includeIgnored === true ? ["--force"] : []), "-A", "--", ...paths],

Evidence 4:



path: src/modules/autonomy/workflows/builder/runtime-resources.ts

line: 81

excerpt:



> function builderAgentRunDir(input: AssignBuilderRuntimeResourcesInput): string {
>   if (resolve(input.workspaceDir) === resolve(input.projectDir)) {
>     return input.runDirPath;
>   }

Evidence 5:



path: src/modules/autonomy/workflows/builder/runtime-resources.ts

line: 111

excerpt:



> KOTA_RUN_DIR: agentRunDir,
> KOTA_RUN_TEMP_DIR: tempRoot,
> KOTA_RUN_ARTIFACT_DIR: artifactRoot,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
