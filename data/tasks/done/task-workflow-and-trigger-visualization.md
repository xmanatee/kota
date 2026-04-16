---
id: task-workflow-and-trigger-visualization
title: Workflow and trigger visualization
status: done
priority: p3
area: clients
summary: Provide birds-eye-view diagrams of triggers, conditions, events, hooks, workflows, and agents, starting with CLI and extending to web client
created_at: 2026-04-15T21:22:35.857Z
updated_at: 2026-04-16T02:51:45.585Z
---

## Problem

There is no way to get a birds-eye view of the system's triggers, conditions, events, hooks, workflows, and agents. Understanding the flow requires reading code across multiple files. This makes it hard to reason about the system holistically, spot gaps, or onboard.

## Desired Outcome

- A visualization that shows the relationships between triggers, events, workflows, agents, and hooks.
- Interactive where possible — not just a static dump.
- CLI output as the first surface, with web client and other clients as extensions.
- Shared logic for assembling the visualization data, so multiple clients can render it.

## Constraints

- The visualization must be generated from actual workflow/agent/hook definitions, not hand-maintained.
- Design the data assembly layer before the rendering layer — the data model should support multiple output formats.
- Keep the visualization useful and clean; avoid information overload.

## Done When

- A CLI command produces a readable visualization of the workflow/trigger/event graph.
- The data layer is reusable by other clients.
- The visualization stays accurate as workflows change (generated, not maintained).
