---
id: task-remove-hardcoded-autonomy-workflow-inventory
title: Remove hardcoded autonomy workflow monitoring inventory
status: ready
priority: p1
area: autonomy
summary: Autonomy still uses MONITORED_WORKFLOW_NAMES even though workflow observation and routing should be definition-driven or event-driven.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

`src/modules/autonomy/shared.ts` defines `MONITORED_WORKFLOW_NAMES` and both
attention-digest and improver depend on that fixed list. This contradicts the
documented architecture: workflows that need queue shaping, recovery,
governance, delivery, or digest observation should declare that intent in their
own definition, and other workflows should react to declared intent or semantic
events.

Adding or removing an autonomy workflow should not require updating a shared
hardcoded inventory.

## Desired Outcome

Autonomy observation no longer depends on a fixed workflow-name list. Workflow
definitions declare the intent that other workflows need, or they emit semantic
events that make the relationship explicit. Attention-digest and improver use
that dynamic surface instead of importing a workflow-name array.

## Constraints

- Do not introduce a second registry of workflow names.
- Do not hide the same hardcoded list under a different filename.
- Keep triggers safe against self-trigger loops.
- Preserve the ability to review failed or interrupted queue-driving workflows.

## Done When

- `MONITORED_WORKFLOW_NAMES` is gone.
- Attention-digest and improver derive observed workflows from workflow metadata, definitions, or semantic events.
- Workflow validation or tests prevent reintroducing a hardcoded monitored workflow inventory.
- Existing autonomy workflow tests cover adding a new observed workflow without editing attention-digest or improver.
