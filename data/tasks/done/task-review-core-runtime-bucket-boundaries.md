---
id: task-review-core-runtime-bucket-boundaries
title: Review core runtime bucket boundaries and structure
status: done
priority: p2
area: architecture
summary: Core workflow, daemon, and tools directories are still large flat buckets; review whether their internal boundaries match the minimal-core architecture.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-14T21:42:14.809Z
---

## Problem

The largest source buckets are still in core: `src/core/tools`,
`src/core/workflow`, and `src/core/daemon`. Some of this is legitimate kernel
surface, but the size and flatness make it hard to see which files are protocol
primitives, runtime orchestration, validation, storage, control API, or
remaining capability implementations.

The risk is that future work keeps adding to core because it is easier than
finding or creating the right module boundary.

## Desired Outcome

Core remains minimal but more navigable. Each large core bucket is reviewed for
files that should move to modules, files that should be grouped into internal
subdomains, and files that are true runtime primitives. The result should make
it easier to add capabilities through modules instead of growing core.

## Constraints

- Do not move code out of core solely to reduce counts.
- Do not create deep folder nesting without a real abstraction boundary.
- Coordinate with `task-extract-composition-tools-from-core-into-an-option`
  and `task-audit-remaining-core-hosted-tools-after-composition`.
- Preserve runtime behavior and restart semantics.

## Done When

- `src/core/tools`, `src/core/workflow`, and `src/core/daemon` each have a clear internal ownership story.
- Any non-core capability code found during the review is moved to modules or captured as a focused follow-up task.
- Local `AGENTS.md` files remain concise and accurate.
- The final structure makes the core/module split easier to understand from the tree alone.
