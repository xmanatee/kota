---
id: task-remove-legacy-runtime-and-manifest-surfaces
title: Remove legacy runtime state fields and duplicate manifest-era surfaces
status: ready
priority: p1
area: runtime
summary: Some legacy runtime state was removed, but the public surface still carries old module terminology and manifest-era extension hooks like `promptSection`, `eventHandlers`, and script conversion. Finish removing the leftover parallel surfaces instead of keeping mixed-era names and concepts alive.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

Some legacy runtime state has already been removed, but the codebase still
exposes obsolete or duplicate surfaces, including:

- old module-oriented naming in extension-facing interfaces
- manifest-era guidance and automation paths layered beside skills and workflows
- older naming that does not match the current extension/agent/workflow model

These leftovers make the runtime harder to reason about and keep the codebase
straddling two architectures at once.

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
- Duplicate or obsolete manifest/runtime names are removed from public docs and
  code.
- Manifest-era public surfaces no longer present themselves as first-class
  runtime concepts beside extensions, skills, agents, and workflows.
- Validation, CLI inspection, and stored state all reflect one clear model.
