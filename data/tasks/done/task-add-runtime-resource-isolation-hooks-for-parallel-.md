---
id: task-add-runtime-resource-isolation-hooks-for-parallel-
title: Add runtime resource isolation hooks for parallel worktrees
status: done
priority: p2
area: platform
task_class: Platform
depends_on: [task-add-workflow-workspace-checkout-contract, task-add-git-worktree-lifecycle-provider-for-automation]
summary: Give parallel worktrees deterministic ports, temp roots, dependency setup, and future database/service isolation hooks so file isolation does not hide runtime collisions.
created_at: 2026-06-25T14:54:07.903Z
updated_at: 2026-06-28T19:04:21.000Z
---

## Problem

Git worktrees isolate files and index state, not running processes. Parallel
agents can still collide on dev-server ports, temp files, local databases,
package-manager caches, build artifacts, and external services. Practitioner
reports repeatedly flag this as the point where naive worktree parallelism
breaks down.

## Desired Outcome

KOTA has per-worktree resource hooks that assign deterministic runtime
resources and setup steps to each automation run. At minimum this covers
workspace temp roots, port ranges, dependency setup/preflight, environment
variables, and artifact paths. The design leaves room for database branching or
service namespaces when a project needs them.

## Constraints

- Do not assume every repo needs a dev server or database.
- Keep defaults lightweight for pure code/docs tasks.
- Avoid global mutable env state shared across concurrent worktrees.
- Record resource assignments in run artifacts and status output.
- Make conflicts fail early at preflight rather than halfway through an agent
  run.

## Done When

- Worktree runs can request a resource profile and receive deterministic env,
  port, temp, and artifact assignments.
- Preflight detects unavailable ports or setup failures before starting the
  mutating agent step.
- Resource assignment is visible in run artifacts and status.
- Tests cover two concurrent resource profiles that do not collide.

## Source / Intent

Upsun and MindStudio both describe the same limitation: worktrees help with
parallel file edits, but preview environments, dependencies, ports, and
databases need separate isolation.

Sources:
https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents
https://www.mindstudio.ai/blog/parallel-ai-coding-agents-git-worktrees

## Initiative

Worktree-backed KOTA autonomy.

## Result

Implemented lightweight builder runtime resource profiles:

- The prepare-worktree step now assigns deterministic per-run temp roots,
  artifact roots, and port ranges, then exposes those assignments through
  workflow step context, child handoff runtime, harness run options, and tool
  execution context env.
- The builder resource allocator serializes port assignment through a shared
  `.kota/runtime-resources/builder-port-leases.json` lease store. When two
  deterministic hashes land in the same bucket, the second active run receives
  the next unleased block instead of colliding.
- The builder preflight now prepares per-run package-manager cache paths and
  dependency setup before the mutating build step. Worktree package projects
  link prepared project `node_modules`; unusable dependency setup fails before
  the agent starts.
- Each run writes `builder-runtime-resources.json` under the run directory with
  temp, artifact, cache, dependency, lease, and port preflight details.
- Automation worktree metadata and the operator UI status surface now include
  resource profile summaries for worktree-backed runs.
- Thin harnesses reject per-run env as unsupported; the CLI/SDK/tool-loop
  harnesses that launch subprocesses or delegated tools propagate the env.

## Acceptance Evidence

- Focused runtime-resource and worktree tests passed:
  `pnpm test src/modules/autonomy/workflows/builder/runtime-resources.test.ts` passed 1 file / 5 tests, including the `task-15:run-15` and `task-21:run-21` hash-collision case plus dependency setup success/failure preflight.
- Worktree/status integration tests passed:
  `pnpm test src/modules/autonomy/workflows/builder/workflow-worktree-mode.test.ts src/modules/autonomy/workflows/builder/workflow-worktree-mode.fixture.test.ts src/modules/git/worktree-lifecycle-status.test.ts src/modules/daemon-ops/operator-ui-worktree-status.test.ts` passed 4 files / 4 tests.
- Validation guard tests passed:
  `pnpm test src/workflow-validation.integration.test.ts src/core/modules/module-deps.test.ts src/strict-types-policy.integration.test.ts` passed 3 files / 87 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm run validate-tasks` passed after staging the final ready-to-done task
  move.
- The canonical task CLI move could not write `.git/index.lock` in this
  sandbox; the failed command output is recorded in
  `.kota/runs/2026-06-28T18-42-51-432Z-builder-1dlez9/task-move-done-attempt.txt`,
  and the task file was moved manually to preserve queue state.
