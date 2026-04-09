---
id: task-approval-conversation-context
title: Include agent conversation context in approval queue items
status: ready
priority: p2
area: operator-ux
summary: Attach the last few agent conversation turns to each approval item so operators understand why the tool call is being made before deciding to approve or reject.
created_at: 2026-04-08T22:45:00Z
updated_at: 2026-04-09T02:03:33Z
---

## Problem

When a guardrail suspends a tool call for human approval, the pending item shows the tool name, input parameters, risk level, and a brief guardrail reason. It does not show what the agent was trying to accomplish — the task description, the reasoning steps that led to the call, or any surrounding conversation history.

Operators must navigate to the related workflow run and scroll through step logs to understand intent. For high-frequency approval queues or time-sensitive decisions (approvals with short expiry), this navigation friction degrades decision quality and slows operator response.

## Desired Outcome

- `PendingApproval` gains an optional `context` field that stores the last N agent messages (configurable, default 3) captured at the moment of guardrail suspension.
- The approvals panel in the web UI renders this context as a collapsed "Why?" section — expanded on click — showing the agent's recent reasoning.
- The `kota approval list` CLI output includes a short one-line context summary (last agent message) when present.
- Context is capped at a reasonable size limit (e.g., 2000 chars) to keep approval files small.

## Constraints

- Context capture must happen in the guardrail/approval enqueue path, not after the fact.
- Avoid storing full conversation history; a short window (last 3 turns) is sufficient for intent.
- Backward-compatible: existing approval items without `context` render unchanged.

## Done When

- `PendingApproval.context` is populated by the guardrail enqueue path.
- The web UI approvals panel renders a collapsible context section for items that have it.
- `kota approval list` shows a one-line context summary per item when present.
- Existing tests pass; new unit test covers context capture in the enqueue path.
