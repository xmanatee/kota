# inbox-sorter-dedup-against-open-tasks

## Source

- Run id: `2026-04-15T21-20-03-042Z-inbox-sorter-j7lclg`
- Workflow: `inbox-sorter`
- Committed in `5d56b6f1` ("Sort inbox: 10 items processed, fix npm→pnpm
  reference").

## What failed

That run's inbox contained ten captures. One of them —
`duplicate-task-about-docs` — restated work already tracked by an
existing docs-audit task in `data/tasks/`. The run's own
`steps/sort-inbox.json` output table records the decision verbatim:
`duplicate-task-about-docs → enriched existing docs audit task,
dropped`. The sorter got it right that time: it enriched the existing
task with the duplicate's examples and dropped the inbox file instead
of scaffolding a second task.

The same run also tripped the `task-queue-valid` repair gate
(`active-guidance-uses-npm` — a `npm i -g` in a newly-promoted task
body), which is logged in `repairIterations[0]`. That secondary
failure confirms the sorter's output is real-world messy and that
quality gates matter; it is not what this fixture is encoding.

The failure shape this fixture captures is the one the sorter avoided
in j7lclg: a regressed sorter that normalizes every inbox item to a
new task without scanning `data/tasks/` for overlap doubles the queue
for every restated idea. That is the failure mode `data/tasks/AGENTS.md`
has warned against ("Before creating a task, scan open tasks and
related inbox items for overlap.") — and the class of rediscovery that
commits like `62d7ca6d` (three duplicate backlog tasks) and `50622921`
(duplicate explorer trigger-form task) had to clean up by hand.

## Why this fixture captures it

The fixture seeds `data/tasks/backlog/task-add-cli-error-message-hints.md`
with a clearly-scoped existing task and drops
`data/inbox/rough-idea-cli-hint-suffixes.md` restating the same idea —
the same overlap shape j7lclg encountered. Predicates require the inbox
to be drained, the existing backlog task to be preserved, and the total
count under `data/tasks/` to stay at one. A sorter that respects dedup
passes; a sorter that mints a duplicate task fails the count predicate
at the harness layer, without needing an improver sweep after the fact.
