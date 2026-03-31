---
id: task-web-ui-approval-input-display
title: Show tool input details in web UI approval panel
status: ready
priority: p3
area: operator-ux
summary: The approval panel shows tool name and risk level but hides the actual tool input, forcing operators to approve or reject without seeing what the tool will do. Rendering the input JSON gives operators the context needed to make informed decisions.
created_at: 2026-03-31T15:07:46Z
updated_at: 2026-03-31T15:07:46Z
---

## Problem

`client-approvals.ts` renders each pending approval with tool name, risk level, and a reason string. The `PendingApproval` object returned by `GET /approvals` includes `input: Record<string, unknown>` — the full structured arguments the tool would be called with — but the web UI discards it. An operator asked to approve a `shell` command, file write, or API call cannot see the actual command or target without checking daemon logs separately.

## Desired Outcome

Each approval item in the web UI shows a collapsible "Input" section below the reason line. Clicking expands a `<pre>` block showing the tool input as pretty-printed JSON. Collapsed by default to keep the panel compact when many approvals are pending.

## Constraints

- Client-side only; `GET /approvals` already returns `input` — no server changes needed.
- Use a `<details>`/`<summary>` element or a simple toggle button; no modal required.
- Truncate very large input objects (>2 KB) with a "Show full input" link to avoid bloating the panel.
- Keep changes inside `client-approvals.ts`.

## Done When

- Each approval item has a collapsible input section.
- Input renders as pretty-printed JSON in a `<pre>` block.
- Section is collapsed by default; toggle is keyboard-accessible.
- Existing approval panel behavior (approve/reject buttons) is unchanged.
- At least one web UI test verifies the input section is present in the rendered output.
