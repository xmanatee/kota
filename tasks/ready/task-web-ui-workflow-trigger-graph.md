---
id: task-web-ui-workflow-trigger-graph
title: Add workflow trigger dependency graph to the web UI definitions panel
status: ready
priority: p3
area: web-ui
summary: Workflows that trigger other workflows via workflow.completed events create implicit dependency chains that are invisible in the definitions panel. A simple dependency graph would let operators understand the full trigger topology at a glance.
created_at: 2026-04-02T07:14:02Z
updated_at: 2026-04-02T13:28:11Z
---

## Problem

KOTA's built-in workflows trigger each other: improver runs after builder, builder
re-runs after explorer produces tasks. As operators add custom workflows that also
use `workflow.completed` triggers, these chains become hard to reason about. The
definitions panel lists each workflow in isolation; there is no view showing which
workflows are upstream or downstream of a given one.

Debugging a trigger loop, planning an enable/disable sequence, or onboarding a new
team member all require mentally reconstructing the graph from reading individual
workflow definitions.

## Desired Outcome

A "Trigger graph" section in the workflow definitions panel (or a dedicated tab)
that renders a simple ASCII or SVG arrow diagram of `workflow.completed` dependencies:

```
explorer ──triggers──▶ builder ──triggers──▶ improver
                            ╰──(on failure)──▶ improver
```

The graph is derived entirely from the `GET /api/workflow/definitions` response —
no new server endpoint is needed. Only `workflow.completed` event triggers are
shown; cron, interval, idle, and webhook triggers are out of scope for this view.

Each node should be clickable (or hoverable) to scroll the definitions panel to
that workflow's row.

## Constraints

- Client-side rendering only; no new API surface.
- If the graph is acyclic, render it top-to-bottom or left-to-right.
- If a cycle is detected (self-trigger loop guard should prevent this, but defensive
  rendering matters), render it as a flat list with a warning rather than looping.
- Keep the rendering dependency-free — no d3, mermaid, or external libraries. A clean
  inline SVG or text layout is sufficient.
- The graph is informational only; no interactive editing.

## Done When

- The definitions panel shows a trigger graph section when at least one
  `workflow.completed` trigger exists.
- Nodes are workflow names; directed edges represent trigger relationships.
- Filter label on the edge is shown when the trigger has a `status` or `workflow` filter.
- The section is hidden (collapsed or absent) when no `workflow.completed` triggers exist.
