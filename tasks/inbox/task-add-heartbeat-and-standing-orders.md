---
title: Add a heartbeat / standing-orders surface distinct from cron
status: inbox
created_at: 2026-03-25
updated_at: 2026-03-25
---

KOTA has cron triggers and idle-triggered workflows, but it does not have a lightweight heartbeat / standing-orders mechanism for periodic awareness work.

Explore a small surface for recurring checks that should be batched, context-aware, and suppress noise when nothing needs attention. Examples:
- queue health
- repeated failing tests or workflows
- stale blocked tasks
- operator digest / check-in rules

This should stay distinct from exact cron scheduling.

References:
- https://docs.openclaw.ai/automation/cron-vs-heartbeat
