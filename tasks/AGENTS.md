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
- **All task files must be named `task-<slug>.md`** (e.g. `task-split-daemon-ts.md`). This applies in every state directory including `inbox/`.
- Inbox items may start as lightweight captures without full frontmatter.
- Once a task leaves `inbox/`, it must use the full task format.
- Required frontmatter keys outside `inbox/`: `id`, `title`, `status`, `priority`, `area`, `summary`, `created_at`, `updated_at`.
  - `id` must equal the filename without the `.md` extension (e.g. file `task-foo-bar.md` → `id: task-foo-bar`).
  - `priority` must be one of `p0`, `p1`, `p2`, or `p3`.
  - `status` must equal the containing directory name (e.g. `status: doing` when the file is in `doing/`).
  - `created_at` and `updated_at` must use ISO 8601 datetime format (`YYYY-MM-DDTHH:MM:SSZ`, e.g. `2026-03-27T06:40:18Z`). Date-only values are accepted but lose same-day tiebreaker precision — always use datetime.
- Required body sections outside `inbox/`: `## Problem`, `## Desired Outcome`, `## Constraints`, `## Done When`.
- `## Plan` is optional and must stay high-level. Do not put deep implementation detail in tasks.
- Tasks should read like product or work specs, not coding instructions.

## Usage

- New owner requests should be added as files under `inbox/`.
- Triage means moving an inbox item to `ready/`, `backlog/`, or `dropped/` and normalizing it into the full task format.
- Keep `ready/` short and deliberately mixed. Do not let `ready/` or `backlog/` collapse into only one task shape such as repeated split, rename, dedup, or test-only cleanup work.
- Before promoting maintenance or refactor tasks, review `doing/`, `ready/`, and recent `done/` work. If the same kind of task already dominated recent iterations, prefer a different kind of improvement next.
- Mechanical split, rename, and dedup tasks are support work by default. Keep at most one such task in `ready/` unless multiple are clearly blocking a larger architectural or capability change.
- File length and local neatness are signals, not goals. Prefer tasks that improve capability, reliability, operator experience, or concept clarity over rote cleanup.
- When the queue is thin, prefer one substantive task over several small cleanup fillers.
- When moving any task between directories, update the `status` frontmatter field to match the target directory name exactly.
- When moving a task file, use `git mv <src> <dst>` to stage the rename atomically. Edit the content (e.g. the `status` field) AFTER `git mv`, then run `git add <dst>` to stage the content change before committing. Editing before `git mv` silently discards the edit — `git mv` uses the index content, not the working tree content.
- Before committing any task file changes, run `git status --short` and verify no paths appear as `D` (deleted, unstaged) or `M` (modified, unstaged). Stage any missing changes before committing.
- If you start and complete a task in one run, move it directly to `done/` instead of leaving a parallel `doing/` copy behind.
- When a task leaves `inbox/`, normalize it into the full task format with the required sections.
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
