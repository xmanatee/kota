---
id: task-security-review-the-runtime-probe-artifact-check-u
title: Security review: The Runtime Probe artifact check uses lexical containment and git ignore status but does not reject symbolic links. It also runs before the probe command. An agent can pre-create runtime-probe.json as a symlink, or workspace probe code can create it during execution; the subsequent writeFileSync follows that link and overwrites an arbitrary daemon-user-writable target.
status: done
priority: p2
area: security
task_class: Safety
summary: The Runtime Probe artifact check uses lexical containment and git ignore status but does not reject symbolic links. It also runs before the probe command. An agent can pre-create runtime-probe.json as a symlink, or workspace probe code can create it during execution; the subsequent writeFileSync follows that link and overwrites an arbitrary daemon-user-writable target.
created_at: 2026-07-26T01:23:53.754Z
updated_at: 2026-07-27T03:16:36.376Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/critic-runtime-probe.ts
claim:

> The Runtime Probe artifact check uses lexical containment and git ignore status but does not reject symbolic links. It also runs before the probe command. An agent can pre-create runtime-probe.json as a symlink, or workspace probe code can create it during execution; the subsequent writeFileSync follows that link and overwrites an arbitrary daemon-user-writable target.

## Desired Outcome

> Validate the real run-directory path after probe execution and perform the final write with no-follow semantics, rejecting symbolic links and non-regular files atomically. Validate parent components against the real workspace root and add regressions for both pre-planted and probe-created artifact symlinks.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-25T23-25-05-242Z-security-review-7qz0ka.

finding id: security-review-runtime-probe-artifact-symlink-write
candidate id: tool-execution:src/modules/autonomy/critic-runtime-probe.ts:1
verdict: confirmed
rationale:

> assertArtifactPathStageable performs lexical containment and git-ignore checks before probe execution but never inspects symbolic links (critic-runtime-probe.ts:23-26,43-83). The later writeFileSync follows the artifact pathname (lines 35-39), allowing either a pre-planted or probe-created runtime-probe.json symlink to overwrite its target. The run evidence independently records acceptance of such a symlink and modification of the external target.

Evidence:

Evidence 1:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 23

excerpt:



> const artifactPath = join(runDir, "runtime-probe.json");

Evidence 2:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 35

excerpt:



> const result = { ...runTaskProbe(probe, projectDir), provenance };

Evidence 3:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 39

excerpt:



> writeFileSync(artifactPath, JSON.stringify(result, null, 2));

Evidence 4:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 47

excerpt:



> const workspaceRoot = resolve(workspaceDir); const resolvedArtifact = resolve(artifactPath);

Evidence 5:



path: src/modules/autonomy/critic-runtime-probe.ts

line: 61

excerpt:



> const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", "--", workspacePath],

Evidence 6:



path: .kota/runs/2026-07-25T23-25-05-242Z-security-review-7qz0ka/critic-runtime-probe-symlink-evidence.json

line: 4

excerpt:



> The stageability check returned status 1, then writing through the accepted artifact symlink changed the external target from ORIGINAL to REPLACED.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node node_modules/vitest/vitest.mjs run src/modules/autonomy/critic-runtime-probe-artifact.test.ts src/modules/autonomy/critic-runtime-probe-sandbox.integration.test.ts src/modules/autonomy/critic-runtime-probe.test.ts src/modules/autonomy/task-probe-coredump.integration.test.ts src/modules/autonomy/task-probe-hard-links.test.ts src/modules/autonomy/task-probe-runner.test.ts src/modules/autonomy/task-probe-sandbox.test.ts src/modules/autonomy/task-probe-toolchain.test.ts src/modules/autonomy/task-probe.test.ts --configLoader runner` — 8 files passed, 1 platform-skipped; 52 tests passed, 2 platform-skipped.
- `node_modules/.bin/tsc --noEmit` — passed.
- `node_modules/.bin/biome check src/` — 2,825 files checked with no fixes or findings.
- `.kota/runs/2026-07-27T02-48-33-019Z-builder-7p7wnk/security-regression.txt` records the focused external-target preservation evidence.
