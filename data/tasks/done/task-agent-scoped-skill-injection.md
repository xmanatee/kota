---
id: task-agent-scoped-skill-injection
title: Make agent skill injection explicit and scoped
status: done
priority: p2
area: core
summary: AgentDef.skills is declared but never resolved into agent prompts; skill injection should be explicit per agent instead of silently global.
created_at: 2026-04-11T14:10:00Z
updated_at: 2026-04-11T14:10:00Z
---

## Problem

`AgentDef` has a `skills?: string[]` field, but it is never used during prompt
assembly. All module-contributed skills are concatenated into a single global
"Module Capabilities" section via `getSkillsPrompt()` in loop-init. This means:

- Every agent gets every skill, defeating agent specialization.
- The `skills` declaration is metadata-only, creating a false sense of scoping.
- As the skill count grows, agent context windows fill with irrelevant guidance.

## Desired Outcome

Agents declare the exact skill set they receive. A deliberate all-skills mode
must be explicit rather than inferred from a missing field. The global injection
path in loop-init should respect the declared scope.

## Constraints

- Do not use a missing `skills` field as an implicit all-skills default.
- Do not change the `SkillDef` type unless the stricter agent contract requires it.
- Keep the change in `src/core/loop/` or `src/core/agents/`.
- Do not add a parallel skill resolution system.

## Done When

- Agent-declared skills are resolved and only those skills appear in the agent's
  system prompt.
- Agents that should receive all skills declare that intent explicitly.
- At least one existing agent definition uses the scoped `skills` field.
