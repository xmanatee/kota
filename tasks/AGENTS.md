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
  - `priority` must be one of `p0`, `p1`, `p2`, or `p3`. Use these definitions:
    - `p0` — Production incident, blocking defect, or system broken; address immediately.
    - `p1` — Critical capability or reliability gap; should be next in queue.
    - `p2` — Significant improvement to capability, reliability, or operator experience; prioritize over general enhancements.
    - `p3` — Normal enhancement, polish, or refactor with clear value but no urgency.
  - `status` must equal the containing directory name (e.g. `status: doing` when the file is in `doing/`).
  - `created_at` and `updated_at` must use ISO 8601 datetime format (`YYYY-MM-DDTHH:MM:SSZ`, e.g. `2026-03-27T06:40:18Z`). Date-only values are accepted but lose same-day tiebreaker precision — always use datetime.
- Required body sections outside `inbox/`: `## Problem`, `## Desired Outcome`, `## Constraints`, `## Done When`.
- `## Plan` is optional and must stay high-level. Do not put deep implementation detail in tasks.
- Tasks should read like product or work specs, not coding instructions.
- Tasks should describe what must become true and why it matters. Builder owns
  the detailed technical plan, research path, file-level decomposition, and
  implementation choices unless a specific sequencing or protocol invariant
  truly has to be pinned down in the task itself.

## Usage

- New owner requests should be added as files under `inbox/`.
- Triage means moving an inbox item to `ready/`, `backlog/`, or `dropped/` and normalizing it into the full task format.
- Keep `ready/` short and deliberately mixed. Do not let `ready/` or `backlog/` collapse into only one task shape such as repeated split, rename, dedup, or test-only cleanup work.
- Treat queue size targets as lower bounds, not proof of quality. A queue with enough items can still be too local, too timid, or too repetitive.
- Before promoting maintenance or refactor tasks, review `doing/`, `ready/`, and recent `done/` work. If the same kind of task already dominated recent iterations, prefer a different kind of improvement next.
- Mechanical split, rename, and dedup tasks are support work by default. Keep at most one such task in `ready/` unless multiple are clearly blocking a larger architectural or capability change.
- File length and local neatness are signals, not goals. Prefer tasks that improve capability, reliability, operator experience, or concept clarity over rote cleanup.
- When the queue is thin, prefer one substantive task over several small cleanup fillers.
- Keep some real range in the open queue over time: architecture/protocol work, operator or client-facing work, capability expansion, and reliability work should all be represented. Do not let one local theme crowd out the rest.
- When the documented architecture and the live runtime shape diverge, prefer
  tasks that close that gap over more p3 polish.
- Keep at least one live task aimed at shrinking or clarifying the core when
  capability code is obviously pooling in large shared buckets instead of clear
  extension boundaries.
- While that architecture gap is still obvious, keep the front of `ready/`
  pointed at extension-first/core-shrinking work rather than letting secondary
  client or polish tasks outrank it at the same priority.
- Do not let the actionable queue degrade into only `p3` work by default. If
  `ready/`, `doing/`, and `backlog/` together contain only `p3` tasks, create
  or promote at least one real `p1`/`p2` next bet instead of accepting
  maintenance mode prematurely.
- If the repository still visibly reads flatter than the target
  extension-owned shape, or shared capability policy is still pooling in core,
  `ready/` should keep at least one p1/p2 architecture task aimed at shrinking
  that remaining debt. Do not let `ready/` become only side-work while that
  gap is still obvious.
- When moving any task between directories, update the `status` frontmatter field to match the target directory name exactly.
- Prefer `git mv <src> <dst>` for tracked task files, but do not treat it as a fragile ritual. If the queue is already inconsistent, fix the file layout directly and finish with `git add -A` so the staged state matches reality.
- Before finishing, make sure task-file validations would pass: no duplicate task ids across states, no stale deleted task paths, no untracked task files, and no status/directory mismatches.
- If you start and complete a task in one run, move it directly to `done/` instead of leaving a parallel `doing/` copy behind.
- When a task leaves `inbox/`, normalize it into the full task format with the required sections.
- Before creating a new task, scan related open work in `inbox/`, `backlog/`, `ready/`, `doing/`, and `blocked/`.
- If a related task already exists, prefer updating its context over creating a duplicate.
- If research or implementation uncovers a genuinely useful follow-up idea, capture it in `inbox/` or enrich an existing task, but do not turn every observation into process overhead.
- If one investigation reveals several distinct, non-overlapping improvements, it is correct to create several task files. Do not collapse materially different next bets into one vague umbrella task just to keep the queue smaller.
- Use `inbox/` for lightly captured ideas that still need triage. Use `backlog/` for work that is already clear and worth returning to, but should not jump straight to `ready/`.
- Pull work from `ready/`.
- Move a task to `doing/` when work actually starts.
- Promote work from `backlog/` only when it is actionable.
- Move files between state directories as work progresses.
- Move stuck work to `blocked/` with an explicit blocker.
- `done/` and `dropped/` are terminal states. Do not add another archive layer.
- For a quick scan, use `rg -n --glob '*.md' '^(title|priority|summary):' tasks/{inbox,ready,doing,blocked,backlog}`.
