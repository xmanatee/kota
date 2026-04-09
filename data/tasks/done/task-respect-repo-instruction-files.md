---
id: task-respect-repo-instruction-files
title: Respect repo instruction files
status: done
priority: p1
area: instructions
summary: Load repo-local instruction files so KOTA can follow root and directory guidance the way coding agents are expected to.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

KOTA needed to understand repo-local `AGENTS.md` and `CLAUDE.md` files instead
of depending only on hardcoded prompt text.

## Desired Outcome

Root and ancestor instruction files should be loaded automatically across the
main execution paths.

## Constraints

- Keep loading deterministic and easy to reason about.
- Support repo-style indirection through referenced docs files.
- Avoid prompt bloat.

## Done When

- Main execution paths load repo instruction context automatically.
- Directory guidance can shape agent behavior without hardcoding it into prompts.
- Remaining gaps are follow-up work, not missing baseline support.
