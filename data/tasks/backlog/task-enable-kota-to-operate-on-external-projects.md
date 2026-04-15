---
id: task-enable-kota-to-operate-on-external-projects
title: Enable KOTA to operate on external projects
status: backlog
priority: p2
area: architecture
summary: Refactor KOTA to support running autonomous workflows on projects beyond its own repo, requiring better encapsulation and abstraction of project-specific concerns
created_at: 2026-04-15T21:22:29.867Z
updated_at: 2026-04-15T21:22:29.867Z
---

## Problem

KOTA currently only develops and improves itself. The owner wants to run KOTA's autonomous workflows (inbox sorting, task execution, exploration, improvement) on other projects — creating inbox tasks for a project and having the daemon pick them up automatically. This requires separating KOTA-specific concerns from general autonomous development capabilities.

## Desired Outcome

- KOTA can be pointed at an external project and run autonomous workflows against it.
- Project-specific context (AGENTS.md, data/, docs/) is discovered from the target project, not hardcoded to KOTA's own repo.
- The daemon can manage workflows across multiple project roots.
- Shared logic (workflow runtime, agent loop, tool protocols) is cleanly separated from KOTA-specific configuration.

## Constraints

- Requires careful architecture assessment before implementation — this is a significant refactoring.
- Must not degrade KOTA's own self-development workflow during the transition.
- Encapsulation and abstraction boundaries need design review, not just mechanical extraction.

## Done When

- KOTA can run at least one autonomous workflow (e.g. inbox-sorter, builder) against a separate project repo.
- Project-specific context is read from the target project, not KOTA's own tree.
- KOTA's self-development workflows continue to work unchanged.
