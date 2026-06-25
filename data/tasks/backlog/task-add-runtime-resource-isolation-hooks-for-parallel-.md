---
id: task-add-runtime-resource-isolation-hooks-for-parallel-
title: Add runtime resource isolation hooks for parallel worktrees
status: backlog
priority: p2
area: platform
task_class: Platform
depends_on: [task-add-workflow-workspace-checkout-contract, task-add-git-worktree-lifecycle-provider-for-automation]
summary: Give parallel worktrees deterministic ports, temp roots, dependency setup, and future database/service isolation hooks so file isolation does not hide runtime collisions.
created_at: 2026-06-25T14:54:07.903Z
updated_at: 2026-06-25T14:54:07.903Z
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

## Acceptance Evidence

- `pnpm test src/core/workflow src/modules/autonomy` or the nearest affected
  resource-profile tests pass.
- A fixture starts two worktree runs with distinct temp roots and ports.
- A preflight fixture refuses a port collision before agent execution begins.
