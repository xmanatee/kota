---
id: task-security-review-harness-parity-preview-artifact-ca
title: Security review: Harness-parity preview artifact capture follows agent-created symlinks when deciding a declared artifact is a file, then copies or preserves that path into the run artifact directory and reports it as preserved. A harness run can leave `.kota/runs` artifacts pointing outside the materialized scenario workspace, and symlinked parent directories can cause outside-file contents to be copied into operator artifacts.
status: ready
priority: p2
area: security
summary: Harness-parity preview artifact capture follows agent-created symlinks when deciding a declared artifact is a file, then copies or preserves that path into the run artifact directory and reports it as preserved. A harness run can leave `.kota/runs` artifacts pointing outside the materialized scenario workspace, and symlinked parent directories can cause outside-file contents to be copied into operator artifacts.
created_at: 2026-06-28T22:12:39.285Z
updated_at: 2026-06-28T22:12:39.285Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/harness-parity/runner-files.ts
claim:

> Harness-parity preview artifact capture follows agent-created symlinks when deciding a declared artifact is a file, then copies or preserves that path into the run artifact directory and reports it as preserved. A harness run can leave `.kota/runs` artifacts pointing outside the materialized scenario workspace, and symlinked parent directories can cause outside-file contents to be copied into operator artifacts.

## Desired Outcome

> Harden preview artifact capture by rejecting symlinks with lstat-based checks on the artifact path and its parents, resolving real paths to prove the source remains inside the materialized working directory, and copying only regular files. Add a regression test where a declared preview artifact is a symlink or has a symlinked parent and assert it is not preserved.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-28T21-51-36-193Z-security-review-3bivd9.

finding id: harness-parity-preview-artifact-symlink-preservation
candidate id: task-workflow-mutation:src/modules/harness-parity/runner-files.ts:9
verdict: confirmed
rationale:

> src/modules/harness-parity/runner-stage.ts:56-93 runs the harness in the mutable workingDir, then runs verification, then captures declared preview artifacts. src/modules/harness-parity/runner-files.ts:92-115 builds source with join(workingDir, sourcePath), checks it with statSync(source).isFile(), which follows symlinks, then cpSyncs it into the artifact directory. The scenario loader only lexically bounds declared paths in src/modules/harness-parity/scenario.ts:166-226, so a harness or verifier can replace the declared path or one of its parents with a symlink after load. Direct symlink sources can be preserved as artifact symlinks, and symlinked parents can cause outside-file contents to be copied. The summary also reports preserved artifacts by path at src/modules/harness-parity/runner-trace-summary.ts:92-97.

Evidence:

Evidence 1:



path: src/modules/harness-parity/runner-files.ts

line: 92

excerpt:



> for (const sourcePath of args.previewArtifacts) {

Evidence 2:



path: src/modules/harness-parity/runner-files.ts

line: 93

excerpt:



> const source = join(args.workingDir, sourcePath);

Evidence 3:



path: src/modules/harness-parity/runner-files.ts

line: 104

excerpt:



> if (!statSync(source).isFile()) {

Evidence 4:



path: src/modules/harness-parity/runner-files.ts

line: 115

excerpt:



> cpSync(source, artifactPath);

Evidence 5:



path: src/modules/harness-parity/runner-trace-summary.ts

line: 96

excerpt:



> lines.push(`  - ${preview.sourcePath}: ${preview.artifactPath}`);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
