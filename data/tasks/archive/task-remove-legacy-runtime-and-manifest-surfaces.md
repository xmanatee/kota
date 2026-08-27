---
status: done
---

# Remove legacy runtime state fields and duplicate manifest-era surfaces

## Problem

Some legacy runtime state has already been removed, but the codebase still
exposes obsolete or duplicate surfaces, including:

- old module-oriented naming in module-facing interfaces
- manifest-era guidance and automation paths layered beside skills and workflows
- older naming that does not match the current module/agent/workflow model

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
  runtime concepts beside modules, skills, agents, and workflows.
- Validation, CLI inspection, and stored state all reflect one clear model.
