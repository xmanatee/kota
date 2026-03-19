---
id: task-establish-file-based-task-system
title: Establish file-based task system
status: done
priority: p1
area: process
summary: Replace the mixed TODO and plans surfaces with a single task-state system plus concise supporting docs.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

The repo had overlapping planning surfaces, repeated process text, and unclear
distinctions between backlog, active work, and historical design notes.

## Desired Outcome

There should be one clear live work queue, concise directory guidance, and no
separate active planning category.

## Constraints

- Keep task files lightweight and high-level.
- Avoid duplicating process rules across prompts and docs.
- Preserve useful historical notes without keeping them in the active workflow.

## Done When

- `tasks/` is the live work queue with explicit state directories.
- Root and directory instructions point at the same system.
- Historical design notes are no longer presented as an active planning surface.
