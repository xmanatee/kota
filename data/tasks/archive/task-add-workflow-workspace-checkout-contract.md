---
status: done
---

# Add workflow workspace checkout contract

## Problem

Workflow execution currently treats `projectDir` as both the canonical project
root and the place where agent tools mutate files. Agent run options derive cwd
from `agentConfig.projectDir`, and repair/validation surfaces generally assume
the same path. That blocks worktree-backed execution because run metadata and
queue state should remain anchored to the canonical project while edits happen
in an isolated checkout.

## Desired Outcome

Workflow runtime and agent-step APIs can carry both:

- `projectDir`: canonical KOTA project path for config, task queue, run
  artifacts, scheduler state, and daemon status;
- `workspaceDir`: mutable checkout path used by agent cwd, shell cwd, file
  tools, repair checks, validation, commit, and merge preparation.

Existing workflows continue to behave the same when no workspace override is
provided.

## Constraints

- Keep the contract explicit and typed. Avoid passing alternate cwd through
  unstructured prompt text.
- Do not move `.kota/runs` or task queue ownership into transient worktrees.
- Keep backward compatibility for read-only or control-only workflows that do
  not need a mutable workspace.
- Make the default path choice visible in tests so future steps do not silently
  regress to `projectDir`.

## Done When

- Workflow context or agent-run options expose a tested `workspaceDir` concept.
- Agent step cwd uses `workspaceDir` when present and `projectDir` otherwise.
- Validation and repair steps can be directed at `workspaceDir` while recording
  artifacts under the canonical run directory.
- Dirty-recovery and status code can distinguish canonical checkout dirtiness
  from workspace checkout dirtiness.
- Unit tests cover default behavior and workspace override behavior.

## Source / Intent

The owner wants all automation-agent work to happen in worktrees and then merge
cleanly. Local scan found the current agent cwd comes from
`src/core/workflow/steps/step-executor-agent-run-options.ts`, and the builder
workflow still edits the canonical checkout before branch/commit.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/core/workflow` passes.
- A focused fixture proves an agent step receives `workspaceDir` as cwd while
  the run artifact path remains under the canonical project.
- No existing non-worktree workflow changes cwd behavior unless it opts in.
