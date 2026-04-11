---
id: task-clean-root-kota-runtime-artifact
title: Remove root kota runtime artifact and prevent recurrence
status: done
priority: p2
area: runtime-state
summary: A root kota/runs artifact exists even though runtime state must live under .kota/; cleanup and validation should make this drift visible.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

The repo root contains an ignored `kota/runs/.../commit-message.txt` artifact.
Project standards say runtime state belongs under `.kota/`, not sibling root
directories such as `kota/` or `runs/`.

Because `/kota/` is ignored, this can silently persist outside normal git
review and confuse operators.

## Desired Outcome

The stray root runtime artifact is removed, and the repo has a clear guard that
flags root runtime directories when they reappear.

## Constraints

- Do not move runtime evidence into git.
- Do not add a new archive surface.
- Prefer improving existing doctor or validation behavior over adding another
  maintenance command.
- Keep `.kota/` as the only runtime state root.

## Done When

- The root `kota/` artifact is gone.
- `kota doctor` or an existing validation path reports root `kota/` and `runs/`
  directories as drift when present.
- Documentation and `.gitignore` remain consistent with the chosen behavior.
