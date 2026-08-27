---
status: done
---

# Move agent prompts and guidance into files

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
