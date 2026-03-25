---
title: Let the same workflow agent fix failed post-checks before the run ends
status: inbox
created_at: 2026-03-25
updated_at: 2026-03-25
---

Right now a workflow agent step can finish, then later verification steps fail, and only the next improver/builder cycle reacts. That is wasteful when the same agent could immediately address the failing checks with full local context.

Explore an optional post-check repair loop:
- run the agent
- run checks
- if checks fail, feed the failing results back to the same agent
- only finish the workflow when checks pass or the repair budget is exhausted

This should stay clear, bounded, and easy to audit.
