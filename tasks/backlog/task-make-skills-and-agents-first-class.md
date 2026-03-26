---
id: task-make-skills-and-agents-first-class
title: Make skills and agent definitions first-class runtime concepts
status: backlog
priority: p1
area: architecture
summary: Repo instructions, prompt sections, workflow prompts, and ad hoc delegate prompts currently overlap. Add one first-class skill surface and one first-class agent definition surface so explorer, builder, improver, and future specialists all use the same model.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

KOTA currently spreads reusable guidance across:

- repo `AGENTS.md` and `CLAUDE.md`
- module `promptSection`
- workflow prompt markdown files
- delegate-specific prompt assembly

At the same time, specialist workers exist mostly by convention rather than as a
single first-class agent definition model.

## Desired Outcome

- `skill` becomes the one reusable guidance concept.
- Repo instruction files are treated as scoped skills.
- `agent` becomes a first-class definition with role, defaults, skills, tool
  policy, and ownership scope.
- `explorer`, `builder`, and `improver` are expressed as built-in agents that
  workflows invoke.

## Constraints

- Do not create a second prompt layering system beside skills.
- Keep prompts editable in files, but make the surrounding model explicit.
- Avoid duplicating guidance across skills, prompts, and docs.

## Done When

- There is one clear skill model in code and docs.
- There is one clear agent-definition model in code and docs.
- Built-in autonomy roles use that model instead of prompt-only conventions.
- Existing repo instructions and delegate behavior map cleanly onto skills and agents.

## References

- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.openclaw.ai/tools/creating-skills
- https://openai.com/index/introducing-the-codex-app/
