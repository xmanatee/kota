---
id: task-add-post-check-agent-resume-loop
title: Post-check repair loop for workflow agent steps
status: done
priority: p2
area: workflow
summary: When an agent step completes and post-checks fail, the same agent could immediately repair the issue with full local context rather than waiting for the next improver/builder cycle. Add an optional bounded repair loop within the workflow run.
created_at: 2026-03-25
updated_at: 2026-03-27T03:45:00Z
---

## Problem

When a workflow agent step finishes and the subsequent verification steps fail, recovery only happens in the next improver or builder cycle. This wastes a full cycle when the same agent — still warm, with full local context — could fix the issue immediately.

## Desired Outcome

- Workflow steps support an optional post-check repair loop: run agent → run checks → if checks fail, feed results back to the same agent → repeat until pass or budget exhausted.
- The loop is bounded (max repair attempts configurable) and auditable in run output.
- Workflows that do not opt in are unaffected.

## Constraints

- Keep the loop simple, bounded, and easy to audit in run history.
- Do not conflate this with the broader improver recovery path.
- The mechanism should be opt-in at the workflow step level, not global.

## Done When

- An agent step can declare a post-check repair loop in its workflow definition.
- The loop runs checks, feeds failures back to the agent, and retries up to the configured budget.
- Run history and step output clearly show each repair iteration.
- Tests cover the happy path, a repair success, and budget exhaustion.
