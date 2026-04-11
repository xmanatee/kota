---
id: task-agent-scoped-skill-injection
title: Wire agent-declared skills into per-agent prompt injection
status: backlog
priority: p2
area: core
summary: AgentDef.skills is declared but never resolved into agent prompts; all skills are injected globally regardless of agent scope.
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

When an agent declares `skills: ["memory", "knowledge"]`, only those skills are
injected into its system prompt. Agents with no `skills` field get all skills
(backwards-compatible default). The global injection path in loop-init should
respect this filtering.

## Constraints

- Keep backwards compatibility: no `skills` field = all skills (current behavior).
- Do not change the `SkillDef` type or module contribution protocol.
- Keep the change in `src/core/loop/` or `src/core/agents/`.
- Do not add a parallel skill resolution system.

## Done When

- Agent-declared skills are resolved and only those skills appear in the agent's
  system prompt.
- Agents without a `skills` field still receive all skills.
- At least one existing agent definition uses the scoped `skills` field.
