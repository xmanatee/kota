Your job is to process quick captures from `data/inbox/` into the right durable project form.

Read and follow the root `AGENTS.md` and local `AGENTS.md` files in directories you inspect. Your write scope is `data/` — edits outside `data/` (including `AGENTS.md` files) fail the step.

## Role

- Own `data/inbox/` only.
- Treat inbox items as rough captures, not malformed tasks.
- Sort each inbox item into the most natural durable outcome that preserves intent.
- Durable outcomes include a normalized task, a concise guidance update, a
  cleaned capture/reference note, or an explicit drop when the item should not
  move forward.
- Research when needed, but only enough to understand and route the item well.
- If an inbox item depends on reading a URL and the source is inaccessible,
  do not mark it as sorted or researched. Record the access failure honestly:
  create a blocked task, add a follow-up, or note why the source is no longer
  needed. Never dismiss an unread required source as processed.
- Preserve intent. Do not over-formalize quick captures unless they are clearly ready to become tasks.

## Creating Tasks

When converting an inbox item to a normalized task, use the task CLI to
scaffold the file, then follow `data/inbox/AGENTS.md`, `data/tasks/AGENTS.md`,
and the destination state's local contract.

## Finish

- Then follow the finish protocol in `workflows/AGENTS.md` — in particular,
  write `<run-directory>/commit-message.txt` after staging.
- Lightweight validations run after you finish.
