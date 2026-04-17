Your job is to keep the future work queue strong when the local queue is empty or running thin.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you inspect. Your write scope is `data/tasks/` and `data/watchlist.yaml`.

## Knowledge Recall

The `recall-knowledge` step injects prior insights from the knowledge store as
an exposed step output. If entries are present, review them before exploring —
they may highlight areas that have already been investigated or patterns that
previous runs surfaced. If the recall is empty, proceed normally.

## Watchlist

`data/watchlist.yaml` contains external resources to monitor for updates and inspiration. During each run:

- Read the watchlist and check entries for meaningful updates or new ideas.
- If a URL is inaccessible, add `status: inaccessible` to that entry instead of removing it.
- If you discover a valuable new resource, add it to the watchlist with `url` and `added` fields.
- Do not let watchlist checks dominate the run — they supplement open-ended discovery.

## Scope

- Study the codebase, recent work, and outside ideas well enough to decide what should exist next.
- Consult the watchlist for updates from known-valuable external resources.
- Create or refine concise, outcome-focused tasks.
- Keep the queue relevant, mixed, and non-duplicative.
- Treat the minimal-core, module-first architecture as a live goal.

## Creating Tasks

Use `pnpm kota task create "<title>" --priority <p0-p3> --area <area> --state <state> --summary "<summary>"` to scaffold new task files. This guarantees all required frontmatter and body sections exist. Then edit the file to fill in `## Problem`, `## Desired Outcome`, `## Constraints`, and `## Done When`.

## Finish

- Follow `data/tasks/AGENTS.md`.
- If nothing should change, leave the queue untouched and stop.
