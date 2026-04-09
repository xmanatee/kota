---
id: task-linear-task-provider
title: Add Linear task provider so teams can use their Linear workspace as KOTA's task source
status: backlog
priority: p3
area: extensions
summary: Teams that manage work in Linear have to maintain a parallel file queue in data/tasks/ for the builder to pick up. A Linear TaskProvider would let the builder pull directly from Linear issues with no file duplication.
created_at: 2026-04-02T13:57:40Z
updated_at: 2026-04-02T13:57:40Z
---

## Problem

KOTA's `TaskProvider` interface supports pluggable task backends, but only the
file-based provider ships. Teams using Linear as their primary issue tracker must
manually copy or mirror issues into `data/tasks/ready/` before the builder can act on
them, then keep the two sources in sync. This friction discourages autonomous
operation and creates a maintenance burden.

Linear is widely used by engineering teams for sprint planning and backlog management.
A thin provider on top of Linear's GraphQL API would let KOTA treat Linear issues as
its task queue — claim them when work starts, close or update them when done — with
no parallel queue.

## Desired Outcome

A `linear` extension in `src/extensions/` that optionally contributes a `TaskProvider`:

- **List**: returns Linear issues in a configured team/cycle/project matching a label
  filter (e.g. `kota-task`) and not already `In Progress` or `Done`.
- **Claim**: transitions the issue to the `In Progress` state and assigns it to a
  configured Linear user or team bot.
- **Complete**: transitions the issue to `Done` (or a configured completion state)
  and adds a comment with the run summary link.
- Priority is derived from Linear `priority` field (0–4) mapped to KOTA p0–p3.
- `area` is derived from a configurable label-to-area mapping.

Configured via `config.extensions.linear`:
```json
{
  "linear": {
    "apiKey": "${LINEAR_API_KEY}",
    "taskProvider": {
      "enabled": true,
      "teamKey": "ENG",
      "labelFilter": "kota-task",
      "inProgressState": "In Progress",
      "doneState": "Done"
    }
  }
}
```

## Constraints

- Use Linear's official GraphQL API (`https://api.linear.app/graphql`); no third-party
  Linear SDK unless one is already a dependency.
- Follow the same `ProviderRegistry` registration pattern as the file-based task provider.
- Do not modify the `TaskProvider` interface; implement the existing contract.
- Disabled gracefully when `taskProvider.enabled` is false or absent.
- Keep credentials out of logs; follow the secrets masking pattern used by Telegram.
- Two-way sync (push local tasks to Linear) is out of scope.

## Done When

- Linear extension loads and registers a `TaskProvider` when `linear.taskProvider.enabled: true`.
- Builder can list, claim, and complete Linear issues as tasks.
- Priority mapping from Linear priority levels to KOTA p0–p3 works correctly.
- Extension fails gracefully with a clear error when `LINEAR_API_KEY` is missing.
- Unit test covers list (label filter), claim (state transition), and complete (state + comment).
