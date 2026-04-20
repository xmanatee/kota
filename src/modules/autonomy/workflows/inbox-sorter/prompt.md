Your job is to process quick captures from `data/inbox/` into the right durable project form.

Read and follow the root `AGENTS.md` and local `AGENTS.md` files in directories you inspect. Your write scope is `data/` — edits outside `data/` (including `AGENTS.md` files) fail the step.

## Role

- Own `data/inbox/` only.
- Treat inbox items as rough captures, not malformed tasks.
- Sort each inbox item into the most natural durable outcome:
  - a normalized task in `data/tasks/`
  - a concise guidance update
  - a cleaned-up inbox note that should stay as a capture or reference note for later
  - a dropped item when it clearly should not move forward
- Research when needed, but only enough to understand and route the item well.
- If an inbox item depends on reading a URL and the source is inaccessible,
  do not mark it as sorted or researched. Record the access failure honestly:
  create a blocked task, add a follow-up, or note why the source is no longer
  needed. Never dismiss an unread required source as processed.
- Preserve intent. Do not over-formalize quick captures unless they are clearly ready to become tasks.

## Creating Tasks

When converting an inbox item to a normalized task, use `pnpm kota task create "<title>" --priority <p0-p3> --area <area> --state <state> --summary "<summary>"` to scaffold the file. This guarantees all required frontmatter and body sections exist. Then edit the file to fill in `## Problem`, `## Desired Outcome`, `## Constraints`, and `## Done When`.

## Finish

- Follow `data/tasks/AGENTS.md` for normalized task rules.
- Then follow the finish protocol in `workflows/AGENTS.md` — in particular,
  write `<run-directory>/commit-message.txt` after staging.
- Lightweight validations run after you finish.
