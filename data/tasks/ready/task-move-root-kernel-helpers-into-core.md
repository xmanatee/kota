---
id: task-move-root-kernel-helpers-into-core
title: "Move remaining root kernel helpers into core subtrees"
status: ready
priority: p2
area: architecture
summary: "src/ now has the right top-level directories, but too many kernel helpers still live as loose root files. Move the clearly kernel-owned ones into core subtrees so src/ reads as core plus modules instead of a mixed flat bucket."
created_at: 2026-04-10T18:45:00Z
updated_at: 2026-04-10T18:45:00Z
---

## Problem

The repo now has a clean `src/core/` + `src/modules/` directory split, but many
kernel helpers still live directly under `src/` as loose source files. That
weakens the architecture story and makes ownership harder to scan.

## Desired Outcome

Move the remaining clearly kernel-owned root helpers into appropriate
`src/core/<subtree>/` directories, update imports, and leave `src/` root with
only intentional entrypoints or truly exceptional cross-cutting files.

Focus on helpers that are plainly kernel/runtime concerns rather than
operator-facing module code.

## Constraints

- Prefer a few coherent moves over a giant mechanical sweep.
- Do not add compatibility shims or re-export facades.
- Update local `AGENTS.md` files and docs when ownership shifts.

## Done When

- A meaningful cluster of loose root kernel helpers has moved under `src/core/`.
- Import paths and local docs match the new structure.
- `src/` root is materially less flat than before.
