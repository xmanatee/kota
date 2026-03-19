# Tasks

This directory is the live work queue. Task files are the source of truth for
outstanding work.

## States

- `inbox/` = newly captured ideas that are not triaged yet.
- `backlog/` = triaged work that matters but is not ready to pull.
- `ready/` = short actionable pull queue.
- `doing/` = active work in progress. Keep WIP at 1 unless there is a clear reason not to.
- `blocked/` = work that cannot currently move.
- `done/` = recently completed work.
- `dropped/` = work that was explicitly dismissed.
- `archive/` = older completed or dropped tasks that are still worth keeping.

## Task Format

- One task per file.
- Required frontmatter keys: `id`, `title`, `status`, `priority`, `area`, `summary`, `created_at`, `updated_at`.
- Required body sections: `## Problem`, `## Desired Outcome`, `## Constraints`, `## Done When`.
- `## Plan` is optional and must stay high-level. Do not put deep implementation detail in tasks.
- Tasks should read like product or work specs, not coding instructions.

## Usage

- Pull work from `ready/`.
- Promote work from `backlog/` only when it is actionable.
- Move files between state directories as work progresses.
- For a quick scan, use `rg -n --glob '*.md' '^(title|priority|summary):' tasks/{ready,doing,blocked,backlog}`.
