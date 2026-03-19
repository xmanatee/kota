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

## Task Format

- One task per file.
- Inbox items may start as lightweight captures.
- Once a task leaves `inbox/`, it must use the full task format.
- Required frontmatter keys outside `inbox/`: `id`, `title`, `status`, `priority`, `area`, `summary`, `created_at`, `updated_at`.
- Required body sections outside `inbox/`: `## Problem`, `## Desired Outcome`, `## Constraints`, `## Done When`.
- `## Plan` is optional and must stay high-level. Do not put deep implementation detail in tasks.
- Tasks should read like product or work specs, not coding instructions.

## Usage

- New owner requests should be added as files under `inbox/`.
- Triage means moving an inbox item to `ready/`, `backlog/`, or `dropped/` and normalizing it into the full task format.
- Before creating a new task, scan related open work in `inbox/`, `backlog/`, `ready/`, `doing/`, and `blocked/`.
- If a related task already exists, prefer updating its context over creating a duplicate.
- If research or implementation uncovers a genuinely useful follow-up idea, capture it in `inbox/` or enrich an existing task, but do not turn every observation into process overhead.
- Pull work from `ready/`.
- Move a task to `doing/` when work actually starts.
- Promote work from `backlog/` only when it is actionable.
- Move files between state directories as work progresses.
- Move stuck work to `blocked/` with an explicit blocker.
- `done/` and `dropped/` are terminal states. Do not add another archive layer.
- For a quick scan, use `rg -n --glob '*.md' '^(title|priority|summary):' tasks/{inbox,ready,doing,blocked,backlog}`.
