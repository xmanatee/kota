---
id: task-builder-failure-annotation
title: Auto-annotate task files with builder failure summaries
status: done
priority: p2
area: workflow
summary: When the builder determines a task was not completed (via check-task-outcome), it leaves the task in doing/ or moves it back to ready/. There is no persistent record in the task file itself of what was attempted or why it failed. Adding a timestamped failure note to the task file body gives the explorer and future builder runs concrete evidence about difficult tasks.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

Builder failure information lives only in `.kota/runs/<id>/metadata.json`. When the explorer reviews tasks, it has no memory of how many times a task was attempted, what went wrong, or why the builder abandoned it. Tasks can cycle through the queue indefinitely without any operator-visible record of prior attempts.

## Desired Outcome

- When `check-task-outcome` emits a `notDone` or `failed` result, append a brief failure note to the task file body.
- Note format: a markdown section `## Attempt History` (create if absent) with one bullet per failure: date, run ID, and a one-line summary of what happened (from the outcome step output).
- The note must not alter frontmatter or break the task file format.
- If the task file is not found (e.g., already dropped), skip silently.

## Constraints

- Implement in `src/workflows/builder/check-task-outcome.ts` or as a new helper it calls.
- Keep the appended text short — one bullet per attempt, not a transcript.
- Do not move the task between states; that logic already exists and should remain unchanged.
- Handle the case where the task has been moved by the builder to `done/` (no annotation needed).

## Done When

- A failure annotation is written to the task file after a `notDone` outcome.
- The annotation appears under `## Attempt History` in the task body.
- Tests cover: annotation on first failure, second annotation appended to existing history, task file not found (no error).
