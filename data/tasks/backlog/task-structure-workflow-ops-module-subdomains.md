---
id: task-structure-workflow-ops-module-subdomains
title: Structure workflow-ops into clear subdomains
status: backlog
priority: p2
area: workflow-ops
summary: The workflow-ops module is one of the flattest module directories and mixes run inspection, control, history, routes, validation, and definitions.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

`src/modules/workflow-ops/` has many top-level files covering several concerns:
run listing and display, run history and stats, control operations, route
handlers, definition inspection, logs, validation, triggering, and garbage
collection. The module is valid as an ownership boundary, but the internal
layout is flat enough that related behavior is hard to navigate.

Flatness here is more harmful than in a small capability pack because workflow
operations are a broad operator surface with multiple subdomains.

## Desired Outcome

The workflow-ops module remains one module but gains internal structure around
natural subdomains. Related files move together, imports stay clear, and
operator behavior does not change.

## Constraints

- Do not split workflow-ops into multiple modules unless a real runtime
  ownership boundary emerges.
- Do not create barrels or compatibility facades just to preserve old paths.
- Keep route, CLI, and test ownership inside workflow-ops.
- Prefer a small number of meaningful subdirectories over deep nesting.

## Done When

- Workflow-ops files are grouped by clear subdomain instead of one flat bucket.
- Imports use package aliases for cross-tree paths and local relative imports only within a subdomain.
- Tests are co-located with the code they cover after the move.
- Local `AGENTS.md` explains the new internal layout concisely.
