---
id: task-remove-legacy-runtime-and-manifest-surfaces
title: Remove legacy runtime state fields and duplicate manifest-era surfaces
status: done
priority: p1
area: runtime
summary: KOTA still carries legacy workflow state fields and manifest-era naming that no longer matches the desired architecture. Remove the old surfaces directly instead of preserving duplicate terminology and state shapes.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

The codebase still exposes obsolete or duplicate surfaces, including:

- legacy single-run workflow state fields alongside the new active-runs model
- manifest-era terminology that overlaps with extensions and workflows
- older naming that does not match the current explorer/builder/improver model

These leftovers make the runtime harder to reason about and encourage
compatibility logic that preserves outdated concepts.

## Desired Outcome

- Runtime state has one canonical shape.
- Public names and docs reflect the target concept model only.
- Obsolete manifest-era and legacy runtime surfaces are removed instead of kept
  alive behind fallback logic.

## Constraints

- Prefer direct cleanup over compatibility shims.
- Keep persisted state validation strict and legible.
- Do not break run evidence or operator inspection surfaces while simplifying names.

## Done When

- Legacy workflow state fields are gone from the canonical runtime model.
- Duplicate or obsolete manifest/runtime names are removed from public docs and code.
- Validation, CLI inspection, and stored state all reflect one clear model.
