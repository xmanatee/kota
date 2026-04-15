---
id: task-audit-docs-directory-structure-against-agentsmd
title: Audit docs directory structure against AGENTS.md
status: backlog
priority: p2
area: docs
summary: The docs/ directory structure has drifted from what AGENTS.md describes. Audit and reconcile.
created_at: 2026-04-15T14:28:43.925Z
updated_at: 2026-04-15T14:28:43.925Z
---

## Problem

The `docs/` directory currently contains files that may not align with the structure and scope described in `AGENTS.md` and `docs/AGENTS.md`. Potential drift includes: docs that cover topics no longer relevant, missing docs for new subsystems, or files that violate the documentation philosophy (inventories, migration notes, stale references).

## Desired Outcome

- Every file in `docs/` has a clear purpose aligned with the documentation philosophy in `AGENTS.md`.
- Files that are stale, duplicative, or violate doc rules are removed or consolidated.
- `docs/AGENTS.md` accurately describes what belongs in the directory.
- Any gaps (documented subsystems without a corresponding doc) are identified and filed as follow-ups if non-trivial.

## Constraints

- Do not rewrite docs for the sake of rewriting. Only change files that are actually drifted or stale.
- Do not remove docs that are the single source of truth for operator-facing configuration (e.g. `NOTIFICATIONS.md`, `CONFIG.md`).

## Done When

- `docs/` contains only files that pass the documentation philosophy rules.
- `docs/AGENTS.md` is accurate.
- No stale, duplicative, or inventory-style docs remain.
