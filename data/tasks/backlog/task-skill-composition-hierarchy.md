---
id: task-skill-composition-hierarchy
title: Support conditional skill inclusion based on active modules and agent role
status: backlog
priority: p2
area: modules
summary: Skills are flat and unconditionally included. Agents receive all module-contributed skills regardless of relevance. A lightweight filtering mechanism would reduce prompt noise and let modules scope their skills to specific agent roles.
created_at: 2026-04-12T12:35:00Z
updated_at: 2026-04-12T12:35:00Z
---

## Problem

When modules contribute skills via `SkillDef`, those skills are available to
every agent regardless of whether the skill is relevant to the agent's role.
A shell-execution skill is noise for a research-only agent; a Git skill is
irrelevant to a notification-channel agent. As the module count grows, prompt
bloat from irrelevant skills degrades agent focus and wastes tokens.

## Desired Outcome

`SkillDef` supports an optional `roles` or `when` field that scopes the skill
to specific agent roles or conditions. The system-prompt assembly step filters
skills based on the running agent's role, so each agent only sees relevant
guidance.

## Constraints

- Backward compatible: skills without the new field remain universally
  available.
- Keep the filtering logic in the prompt-assembly layer, not in individual
  modules.
- Do not add runtime skill toggling or dynamic skill loading — this is
  static filtering at session start.
- The scoping field should be declarative (role names or tags), not
  imperative (callback functions).

## Done When

- `SkillDef` type includes an optional scoping field (e.g. `roles?: string[]`).
- System-prompt assembly filters skills by the active agent's role.
- At least two existing module skills use the new field to scope themselves.
- An agent with a specific role only receives matching skills in its prompt.
- Tests verify filtering logic and backward compatibility.
