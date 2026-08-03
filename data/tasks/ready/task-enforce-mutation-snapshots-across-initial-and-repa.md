---
id: task-enforce-mutation-snapshots-across-initial-and-repa
title: Enforce mutation snapshots across initial and repair agent execution
status: ready
priority: p1
area: security
task_class: Safety
summary: Replace path-only agent-step attribution with content-sensitive snapshots across the complete initial-plus-repair lifecycle.
depends_on: [task-add-content-sensitive-workflow-mutation-snapshots]
created_at: 2026-08-03T12:57:10.281Z
updated_at: 2026-08-03T12:57:10.281Z
---

## Problem

    A content-sensitive snapshot does not close the vulnerability until executeAgentStep and runAgentRepairLoop share the same pre-step baseline and use it for writeScope enforcement, trajectory changed-file reporting, and violation artifacts.

## Desired Outcome

    Scoped agents cannot rewrite pre-existing dirty out-of-scope files during either the initial harness run or a repair iteration; the runtime reports the exact violating paths while leaving unchanged prior work unattributed.

## Constraints

- Capture the baseline inside the scoped workspace's exclusive execution lane.
- Carry one typed baseline across the full initial and repair lifecycle without introducing a second repair-only boundary.
- Preserve unrestricted agents, in-scope edits, recovery behavior, scratch cleanup, telemetry, and trajectory diagnostics.
- Remove obsolete path-only attribution helpers once all runtime consumers use snapshots.
- Keep enforcement in the core executor and repair runtime rather than prompts or workflow-specific checks.

## Done When

- AgentStepResult carries the typed pre-step mutation snapshot needed by the repair loop.
- Initial agent execution rejects a content change to an already-dirty out-of-scope path.
- Repair-agent execution rejects the same bypass using the original whole-step baseline.
- Unchanged prior dirt and changed in-scope paths remain accepted.
- Violation artifacts and trajectory diagnostics name content-changed pre-existing paths correctly.
- Focused initial-step, repair-loop, and type checks pass.

## Source / Intent

    Complete the fix requested by task-security-review-workflow-agent-steps-snapshot-scop by applying content-sensitive attribution uniformly to workflow agent steps and their repair iterations.

Decomposed from `task-security-review-workflow-agent-steps-snapshot-scop` after builder run `2026-08-03T11-27-25-516Z-builder-s4o6v0` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Passing output from pnpm test src/workflow-step-executor-agent.integration.test.ts src/core/workflow/repair-loop.test.ts.
- Regression fixtures show initial and repair agents both fail with AgentWriteScopeViolationError after rewriting a pre-dirty out-of-scope file.
- The emitted write-scope violation artifact contains the rewritten path.
- Passing pnpm typecheck.
