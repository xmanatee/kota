---
status: done
---

# Establish file-based task system

## Problem

The repo had overlapping planning surfaces, repeated process text, and unclear
distinctions between backlog, active work, owner requests, and historical
notes.

## Desired Outcome

There should be one clear live work queue, concise directory guidance, and no
separate active planning or owner-note tracking category.

## Constraints

- Keep task files lightweight and high-level.
- Avoid duplicating process rules across prompts and docs.
- Keep owner requests and work tracking inside the task system instead of
  parallel files.

## Done When

- `tasks/` is the live work queue with explicit state directories.
- Root and directory instructions point at the same system.
- Owner requests no longer depend on a separate notes file.
