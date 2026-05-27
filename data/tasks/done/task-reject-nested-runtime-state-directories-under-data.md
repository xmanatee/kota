---
id: task-reject-nested-runtime-state-directories-under-data
title: Reject nested runtime-state directories under data surfaces
status: done
priority: p2
area: architecture
summary: Extend repo validation or doctor checks so ignored .kota runtime directories under data/ are reported, then remove the existing data/tasks/.kota run artifact that currently hides outside git review.
created_at: 2026-05-27T23:05:27.650Z
updated_at: 2026-05-27T23:13:55.000Z
---

## Problem

Project standards say runtime state belongs under the project-root `.kota/`
tree and that `data/` is for mutable project data: inbox captures, normalized
tasks, and watchlist state. The current filesystem contains an ignored runtime
artifact under the task queue:

`data/tasks/.kota/runs/2026-04-02T05-04-49-730Z-explorer-zs3lx4/commit-message.txt`

The repo-root `.gitignore` ignores `**/.kota/`, so this nested runtime state is
invisible to normal `git status` review while still showing up in direct
filesystem scans of `data/tasks/`. KOTA already had a root-only cleanup task
for sibling `kota/runs` drift, but that does not cover nested runtime-state
directories inside data surfaces.

Left alone, this creates a quiet second state location under the normalized
task queue and gives agents an ambiguous signal about whether `data/tasks/`
contains only task-state directories.

## Desired Outcome

The repo has a validation or doctor path that reports nested runtime-state
directories under `data/`, and the existing `data/tasks/.kota` artifact is
removed. The guard should make the drift visible even when the files are
ignored by git.

## Constraints

- Do not make nested `.kota` directories trackable as the fix; runtime state
  must remain uncommitted and rooted at project `.kota/`.
- Keep root `.kota/` behavior intact. This task is about forbidden runtime
  directories inside data surfaces, not the legitimate project runtime root.
- Prefer extending an existing validation or doctor surface over adding a new
  maintenance command.
- Do not reject intentional fixture state outside `data/` such as eval-harness
  `initial/.kota/` trees. Scope the rule to the project data surfaces.
- Keep docs unchanged unless the existing standards wording becomes
  inaccurate.

## Done When

- The ignored `data/tasks/.kota/` artifact is gone from the working tree.
- An existing validation or doctor command reports a finding when a `.kota/` or
  `runs/` runtime-state directory appears under `data/`, including ignored
  files that git would hide.
- Focused test coverage proves the guard catches a nested ignored `.kota`
  artifact under `data/tasks/`.
- The normal task queue validation still passes after the cleanup.

## Source / Intent

Explorer run `2026-05-27T23-03-36-696Z-explorer-u2pj9s` inspected a zero
actionable queue. The surfaced strategic blocked alternatives all require
operator-captured evidence and are not movable, so a local architecture hygiene
task is preferable to inventing more operator-gated eval work.

Runtime evidence from this run:

- `find data -path '*/.kota/*' -type f -print` reported
  `data/tasks/.kota/runs/2026-04-02T05-04-49-730Z-explorer-zs3lx4/commit-message.txt`.
- `git check-ignore -v` attributes that file to `.gitignore:5:**/.kota/`,
  which explains why normal git review does not show it.
- `data/tasks/done/task-clean-root-kota-runtime-artifact.md` already closed the
  root sibling-runtime variant. This task covers the distinct nested-data
  variant.

## Initiative

Repository state integrity: KOTA's durable data surfaces should stay
discoverable and unambiguous, while runtime artifacts remain under the single
project `.kota/` root.

## Acceptance Evidence

- Focused test output showing the nested-runtime-state guard failing on a
  seeded `data/tasks/.kota/runs/...` artifact and passing once it is removed.
- Transcript under `.kota/runs/<run-id>/` for the chosen validation or doctor
  command showing no nested runtime-state findings in the real repo.
- `pnpm run validate-tasks` transcript showing the task queue remains valid.
