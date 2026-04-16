---
id: task-assess-task-assignee-model-for-multi-agent-routing
title: Assess task assignee model for multi-agent routing
status: done
priority: p2
area: architecture
summary: Evaluate whether tasks should have assignees to route work to the right agent (explorer, builder, archivarius) and whether tasks should become first-class runtime objects
created_at: 2026-04-15T21:22:27.886Z
updated_at: 2026-04-16T01:28:29.946Z
---

## Problem

Currently only the builder workflow picks up and executes tasks. Different tasks suit different agents: some need exploration (explorer), some need doc review (archivarius), some need implementation (builder). There is no assignee concept to route work appropriately. Additionally, some work is implicitly task-like (inbox items for inbox-sorter, improvement opportunities for improver) but not modeled as tasks.

## Desired Outcome

- An honest assessment of whether task assignees add enough value to justify the complexity.
- If yes: a design for the assignee field, routing logic, and how it interacts with existing workflow triggers.
- Clarity on whether implicit work (inbox items, improvement triggers) should be unified under the task model or remain separate.
- A recommendation on whether tasks should become first-class runtime objects with stricter protocols.

## Constraints

- This is an assessment task, not an implementation task. The output is a design recommendation.
- Do not add complexity for its own sake — the current model works for builder-only execution.
- Consider whether workflow triggers already provide implicit routing and whether explicit assignees would duplicate that.

## Done When

- A written assessment with a clear recommendation (adopt assignees, reject, or defer with rationale).
- If adopting: a concrete design covering the assignee field, routing rules, and interaction with workflow triggers.
- Assessment is committed as a doc or task update, not left in ephemeral conversation.
