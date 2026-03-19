---
id: task-move-agent-prompts-and-guidance-into-files
title: Move agent prompts and guidance into files
status: done
priority: p1
area: workflow
summary: Keep agent prompts and repo guidance in markdown and AGENTS files instead of burying them in code or ad hoc process docs.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

Prompting and process guidance become brittle when they live mainly in code or
in scattered special-purpose files.

## Desired Outcome

Workflow prompts should live in markdown, and repo guidance should be readable
through `AGENTS.md` plus concise docs.

## Constraints

- Keep prompts editable without changing workflow code.
- Avoid turning docs into a second workflow engine.
- Prefer a small number of clear surfaces.

## Done When

- Workflow prompts are file-backed.
- Root and directory guidance lives in instruction files and docs.
- Prompt and guidance structure is easier to maintain.
