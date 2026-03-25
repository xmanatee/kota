---
title: Add a repo-facing hook surface for runtime and agent events
status: inbox
created_at: 2026-03-25
updated_at: 2026-03-25
---

KOTA has an internal event bus and workflow triggers, but it does not yet have a clean repo-facing hook surface comparable to Claude Code or OpenClaw hooks.

Explore a small, explicit hook system for things like:
- workflow lifecycle events
- task state changes
- approvals and failures
- file or tool events where that is safe and useful

This should complement the typed workflow runtime, not create a second confusing automation engine.

References:
- https://code.claude.com/docs/en/hooks
- https://docs.openclaw.ai/automation/
