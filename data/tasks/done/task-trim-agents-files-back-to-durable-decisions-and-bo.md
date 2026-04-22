---
id: task-trim-agents-files-back-to-durable-decisions-and-bo
title: Trim AGENTS files back to durable decisions and boundaries
status: done
priority: p3
area: architecture
summary: Cut implementation inventories, fixture/route lists, and concrete run ids out of src/modules/eval-harness/AGENTS.md and src/modules/autonomy/AGENTS.md so durable docs hold decisions and code holds mechanics
created_at: 2026-04-21T15:53:05.800Z
updated_at: 2026-04-22T04:31:14.701Z
---

## Problem

Recent `AGENTS.md` additions have drifted back toward implementation
inventories, which the documentation standards explicitly reject.

- `src/modules/eval-harness/AGENTS.md` names fixture files, entry points,
  routes, workflow names, and fields that are directly discoverable from
  code and tests.
- `src/modules/autonomy/AGENTS.md` cites concrete `.kota/runs/*` ids as
  evidence even while stating that evidence belongs in run artifacts.
- `docs/STANDARDS.md` says durable docs should hold high-level decisions and
  avoid file inventories, command catalogs, and duplicated implementation
  facts.

## Desired Outcome

The affected `AGENTS.md` files carry durable boundaries, ownership, design
decisions, and contribution rules only. Exact fixtures, routes, event names,
enum values, and run ids live in code, tests, or run artifacts.

- A reader cannot use these files as a catalog to be kept in sync with
  implementation details.
- Evidence anchors remain (pointers to where evidence lives), without
  inlining the evidence itself.

## Constraints

- Do not delete load-bearing architectural decisions or contribution rules;
  this is a trim, not a rewrite.
- Preserve cross-references between `AGENTS.md` files that other agents
  depend on.
- Keep each `AGENTS.md` within the instruction-file cap; shrink, do not
  re-home content into a new doc surface.

## Done When

- `src/modules/eval-harness/AGENTS.md` no longer lists fixture files, entry
  points, routes, or field inventories.
- `src/modules/autonomy/AGENTS.md` no longer inlines concrete run ids as
  evidence; such references become pointers to `.kota/runs/` only.
- `docs/STANDARDS.md` guidance is still satisfied; no new inventory surface
  was created as a side effect.

