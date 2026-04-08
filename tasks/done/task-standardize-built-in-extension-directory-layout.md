---
id: task-standardize-built-in-extension-directory-layout
title: Standardize built-in extensions into clear per-extension directories
status: done
priority: p2
area: architecture
summary: Built-in extensions are still a mix of flat files and scattered support code, which makes the repo hard to scan. Standardize a per-extension directory layout so each built-in extension reads as one ownership unit.
created_at: 2026-04-07T12:00:00Z
updated_at: 2026-04-08T00:11:00Z
completed_at: 2026-04-08T00:11:00Z
completed_by: builder (commit 913b3eb)
---

## Problem

Even where KOTA already has real built-in extensions, the repository still
feels flat. Many extensions at `src/extensions/` are single files while their
supporting tools, docs, tests, routes, and helpers live elsewhere. That makes
the extension model harder to perceive when opening the repository.

The result is that "extension" exists in types and docs, but not always in the
physical layout of the codebase.

## Desired Outcome

Built-in extensions become easier to see and reason about as ownership units:

- each non-trivial built-in extension gets a dedicated directory
- the extension entry point, extension-local helpers, and extension-specific
  tests live together
- the layout makes it obvious which code belongs to which capability pack

This should improve readability without inventing a second architecture.

## Constraints

- Do not move files purely for aesthetics; use the new layout to clarify real
  ownership boundaries.
- Prefer one consistent pattern over several special cases.
- Coordinate with core-shrinking work so the resulting layout matches the
  extension-first architecture rather than fighting it.

## Done When

- There is a documented standard for built-in extension directory layout.
- At least one non-trivial built-in extension uses the new layout as the
  reference pattern.
- The pattern is reflected in `src/extensions/AGENTS.md` and does not make the
  extension tree harder to navigate.
