---
id: task-security-review-the-default-daemon-state-directory
title: Security review: The default daemon state directory is the repository-controlled `.kota` path, but instance-lock and control-file setup follows a symbolic link at that path. A malicious project can redirect daemon ownership files and other state into another daemon-user-writable directory; setup also chmods the symlink target, enabling cross-project state corruption and writes outside the selected project.
status: done
priority: p1
area: security
task_class: Safety
summary: The default daemon state directory is the repository-controlled `.kota` path, but instance-lock and control-file setup follows a symbolic link at that path. A malicious project can redirect daemon ownership files and other state into another daemon-user-writable directory; setup also chmods the symlink target, enabling cross-project state corruption and writes outside the selected project.
created_at: 2026-07-27T10:43:55.811Z
updated_at: 2026-07-27T23:45:27.069Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/daemon/daemon-instance-lock.ts
claim:

> The default daemon state directory is the repository-controlled `.kota` path, but instance-lock and control-file setup follows a symbolic link at that path. A malicious project can redirect daemon ownership files and other state into another daemon-user-writable directory; setup also chmods the symlink target, enabling cross-project state corruption and writes outside the selected project.

## Desired Outcome

> Reject symbolic links in the default project-owned state-root path before reading, chmodding, or writing it, and anchor lock/control mutations to a verified real directory using no-follow filesystem operations. Preserve explicitly configured external state directories as an operator-controlled case. Add a regression using a committed-style `.kota` symlink and verify no target permissions or files change.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-27T09-34-53-266Z-security-review-lgkie5.

finding id: daemon-state-root-symlink-escape
candidate id: daemon-control-route:src/core/daemon/daemon-instance-lock.ts:15
verdict: confirmed
rationale:

> At HEAD 77a6de4b2, the default stateDir remains <project>/.kota and ensurePrivateStateDir still calls recursive mkdirSync plus chmodSync without lstat/no-follow validation. A temporary-project probe made .kota a symlink to a mode-0777 directory; writeControlFile accepted it, created daemon-control.json in the target, and changed the target directory mode from 0777 to 0700.

Evidence:

Evidence 1:



path: src/core/daemon/daemon.ts

line: 77

excerpt:



> const stateDir = config.stateDir ?? join(configuredProjects[0]!.projectDir, ".kota");

Evidence 2:



path: src/core/daemon/daemon-instance-lock.ts

line: 74

excerpt:



> function ensurePrivateStateDir(stateDir: string): void { mkdirSync(stateDir, { recursive: true, mode: 0o700 }); chmodSync(stateDir, 0o700); }

Evidence 3:



path: src/core/daemon/daemon-instance-lock.ts

line: 92

excerpt:



> ensurePrivateStateDir(stateDir); const lockPath = join(stateDir, INSTANCE_LOCK_FILE);

Evidence 4:



path: src/core/daemon/daemon-instance-lock.ts

line: 238

excerpt:



> export function writeControlFile(stateDir: string, payload: DaemonControlFilePayload): void { const controlPath = join(stateDir, CONTROL_FILE);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `pnpm test src/core/daemon/daemon-instance-lock.test.ts src/daemon.integration.test.ts src/core/daemon/daemon-external-project.test.ts src/core/daemon/daemon-multi-project-isolation.test.ts src/core/daemon/daemon-dashboard-snapshot.test.ts` — 5 files and 33 tests passed. The focused regression constructs a default project whose `.kota` entry is a directory symlink and asserts the target remains mode `0777` and empty after daemon construction is rejected. It also covers post-verification state-root replacement and the explicitly configured external-directory case.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm hygiene` — passed.
- `pnpm test:workflow-critical` — passed.
- `pnpm test src/strict-types-policy.integration.test.ts src/root-layout.test.ts` — passed.
- `pnpm validate-tasks` with the workspace-local Git index/object store required by this linked sandbox — passed both while the task was active and after its final move to `done/`.
- Focused post-check repair suite — 8 files and 49 tests passed, covering strict-types policy, scoped workflow runtime queues, approval tools, dead-letter/event-batch flows, owner decisions, the OpenAI tools harness, and secrets.
- Secrets module suite — 4 files and 33 tests passed.
- Full Vitest suite through the cached project-pinned pnpm 10.32.1 binary with the inherited host `PATH` — 1,083 test files passed and 4 skipped; 12,207 tests passed and 16 skipped (12,223 total).
- Final source-size repair — `source-file-size-severe` passed against the workspace-local staged index with three advisory-only warnings; `src/core/daemon/daemon-init.ts` is 264 lines after its lifecycle context and capability-readiness aggregation were split into focused owning files.
- Fresh final repair validation — 14 focused files and 106 tests passed; direct TypeScript no-emit typecheck and Biome source check passed; task validation passed against the workspace-local staged index; hygiene reported no blocking errors.
