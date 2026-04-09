---
id: task-standardize-built-in-module-directory-layout
title: Standardize built-in modules into clear per-module directories
status: done
priority: p2
area: architecture
summary: Built-in modules are still a mix of flat files and scattered support code, which makes the repo hard to scan. Standardize a per-module directory layout so each built-in module reads as one ownership unit.
created_at: 2026-04-07T12:00:00Z
updated_at: 2026-04-08T00:11:00Z
completed_at: 2026-04-08T00:11:00Z
completed_by: builder (commit 913b3eb)
---

## Problem

Even where KOTA already has real built-in modules, the repository still
feels flat. Many modules at `src/modules/` are single files while their
supporting tools, docs, tests, routes, and helpers live elsewhere. That makes
the module model harder to perceive when opening the repository.

The result is that "module" exists in types and docs, but not always in the
physical layout of the codebase.

## Desired Outcome

Built-in modules become easier to see and reason about as ownership units:

- each non-trivial built-in module gets a dedicated directory
- the module entry point, module-local helpers, and module-specific
  tests live together
- the layout makes it obvious which code belongs to which capability pack

This should improve readability without inventing a second architecture.

## Constraints

- Do not move files purely for aesthetics; use the new layout to clarify real
  ownership boundaries.
- Prefer one consistent pattern over several special cases.
- Coordinate with core-shrinking work so the resulting layout matches the
  module-first architecture rather than fighting it.

## Done When

- There is a documented standard for built-in module directory layout.
- At least one non-trivial built-in module uses the new layout as the
  reference pattern.
- The pattern is reflected in `src/modules/AGENTS.md` and does not make the
  module tree harder to navigate.
