---
id: task-documentation-cleanup
title: Clean up docs and prompts to match documentation standards
status: done
priority: p3
area: docs
summary: Remove migration notes, function/directory listings, and other low-value detail from docs and prompts across the repo, keeping documentation high-level, minimal, and scoped close to its subject.
created_at: 2026-04-10T12:47:56Z
updated_at: 2026-04-11T00:00:00Z
---

## Problem

Documentation and prompts across the repo still contain migration notes,
function/method listings, directory inventories, and transitional guidance
that agents can infer from the code. This adds noise, risks staleness, and
makes docs harder to maintain. The updated documentation standards in
`docs/STANDARDS.md` now explicitly prohibit this, but existing content has
not been cleaned up to match.

## Desired Outcome

A single pass through `docs/`, `AGENTS.md` files, and workflow prompt files
to remove:
- Migration notes and transitional guidance for completed migrations.
- Function, method, or file-by-file listings.
- Directory content inventories (unless they explain a non-obvious boundary).
- Redundant content that duplicates what is already in a more scoped location.

After cleanup, every doc should read as concise, high-level guidance that
covers vision, conventions, methodology, or decisions — nothing that an
agent can figure out in a minute of reading the code.

## Constraints

- Do not remove content that captures genuine decisions, conventions, or
  experience-derived guidelines.
- Scope each doc closer to its subject where possible — move global content
  to local `AGENTS.md` files if it only applies locally.
- One pass, not a recurring chore. After this, the standards should keep
  things clean going forward.

## Done When

- No migration notes remain in durable docs or prompts.
- No function/method/directory listings remain in docs.
- All docs are concise, high-level, and scoped to their subject.
