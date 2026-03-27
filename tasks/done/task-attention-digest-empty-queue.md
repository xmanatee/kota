---
id: task-attention-digest-empty-queue
title: Add empty ready/backlog conditions to attention digest
status: done
priority: p2
area: workflow
summary: The attention digest alerts on builder failures, budget pressure, stalled doing tasks, and blocked tasks, but does not alert when the ready or backlog queue drops to zero. An empty ready queue means the builder has nothing to pull; an empty backlog means the explorer has no reserves. These are actionable operational signals worth surfacing.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`detectAttentionItems` in `attention-digest.ts` checks for builder failure streaks, budget pressure, stalled doing tasks, and blocked tasks. It does not check whether the `ready` or `backlog` queues are empty. When the explorer stops producing tasks (or produces them faster than they're consumed), the ready and backlog queues silently drain, causing builder runs to skip or stall without any operator notification.

## Desired Outcome

- If `ready == 0`, add an attention item: "Empty ready queue — builder has nothing to pull."
- If `backlog == 0`, add an attention item: "Empty backlog — no reserves for explorer to promote."
- Both conditions should appear in the digest alongside existing items.
- Use the same `countRepoTasks` call pattern already used for `doing` and `blocked` counts.

## Constraints

- Add to `detectAttentionItems` in `src/workflow/attention-digest.ts`.
- No schema changes — this is purely additive logic.
- Thresholds: alert when count is exactly 0 (not a configurable threshold).
- Keep the attention item messages short and action-oriented.

## Done When

- `detectAttentionItems` emits the two new items when queues are empty.
- Unit tests cover: empty ready, empty backlog, and the case where both are populated (no new items).
