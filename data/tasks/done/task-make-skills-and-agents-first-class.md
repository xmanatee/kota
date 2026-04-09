---
id: task-make-skills-and-agents-first-class
title: Make skills and agent definitions first-class runtime concepts
status: done
priority: p1
area: architecture
summary: Agent definitions now exist and workflows can invoke them by name, but skills are still not the one real reusable guidance surface. Finish the model by removing module `promptSection` as a parallel path beside skills.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

KOTA has made real progress here: `SkillDef` and `AgentDef` exist, built-in
agents are registered explicitly, and workflow agent steps can reference an
agent by name.

But reusable guidance still has two parallel runtime paths:

- skills
- module `promptSection`

That overlap keeps the guidance model muddier than the architecture doc claims,
and it means skills are not yet the one clear way to teach modules and
agents.

## Desired Outcome

- `skill` becomes the one reusable guidance concept in the runtime model.
- Repo instruction files are treated as scoped skills.
- `agent` remains the first-class definition for role, defaults, skills, tool
  policy, and ownership scope.
- `explorer`, `builder`, and `improver` continue to run as built-in agents that
  workflows invoke.

## Constraints

- Do not keep a second prompt layering system beside skills.
- Keep prompts editable in files, but make the surrounding model explicit.
- Avoid duplicating guidance across skills, prompts, and docs.

## Done When

- There is one clear skill model in code and docs.
- There is one clear agent-definition model in code and docs.
- Built-in autonomy roles use that model instead of prompt-only conventions.
- Module `promptSection` is removed or reduced to an internal compatibility
  detail that no longer acts as a public guidance surface.
- Existing repo instructions and delegate behavior map cleanly onto skills and
  agents.

## References

- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.openclaw.ai/tools/creating-skills
- https://openai.com/index/introducing-the-codex-app/
