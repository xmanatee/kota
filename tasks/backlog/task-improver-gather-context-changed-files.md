---
id: task-improver-gather-context-changed-files
title: Add changed-files list from triggering run to ImproverContext
status: backlog
priority: p2
area: workflow
summary: The improver fires after a builder run but must re-read the codebase to figure out what changed. Adding a changedFiles list (from git diff --name-only) to ImproverContext lets the improver immediately focus review on the actual changed files without discovery overhead.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

When the improver is triggered after a builder run, its gather-context step surfaces the triggering run's ID and summary but not which files were modified. The improver must then scan the codebase or rely on commit messages to infer what changed. This adds unnecessary agent reasoning overhead and increases the risk of missing relevant files.

## Desired Outcome

- `ImproverContext` gains a `changedFiles: string[]` field.
- `gatherImproverContext` populates this using `git diff --name-only HEAD~1 HEAD` in the project directory.
- The improver prompt references `changedFiles` to orient its review toward the files that actually changed.
- Falls back to `[]` if git is unavailable or the repo has no prior commits.

## Constraints

- Use the same git invocation pattern as `loadRecentCommits` in `shared.ts`.
- Extract a `loadChangedFiles(projectDir: string): string[]` helper in `shared.ts` so it is reusable.
- Do not include file contents — paths only.

## Done When

- `ImproverContext` includes `changedFiles`.
- `gatherImproverContext` populates it correctly.
- The improver prompt references `changedFiles` in its pre-packaged context section.
- Tests verify the field is populated from git diff output.
