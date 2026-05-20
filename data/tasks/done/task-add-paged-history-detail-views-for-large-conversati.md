---
id: task-add-paged-history-detail-views-for-large-conversati
title: Add paged history detail views for large conversations
status: done
priority: p2
area: modules
summary: Extend the history module so daemon, API, and CLI callers can inspect long conversations through bounded summary/window/full views instead of always returning every stored message.
created_at: 2026-05-20T06:09:48Z
updated_at: 2026-05-20T09:47:42Z
---

## Problem

KOTA's history detail contract is still all-or-nothing. `HistoryClient.show`
returns the full `ConversationData`, `/history/:id` and `/api/history/:id`
serialize every stored message, and `kota history show` reads that full
payload before rendering only the first 200 characters of each text message.
Large action sessions and long user chats therefore force every client to pull
the whole transcript even when the operator only needs metadata or a small
message window.

OpenAI Codex's current app-server work now treats large threads as pageable
state: clients can request unloaded, summary, or full turn-item views instead
of one full transcript. KOTA has the same scaling shape in the history module,
but the bounded-list discipline already present in history search does not
extend to per-conversation detail reads.

## Desired Outcome

The history module exposes one strict typed detail-read contract that supports:

- record-only metadata for cheap list-click and overview use;
- bounded message windows with explicit offset, limit, total count, and
  truncation metadata for operator inspection; and
- an explicit full-state path for resume/internal callers that genuinely need
  every message.

Daemon-control routes, web API routes, `HistoryClient`, and `kota history show`
all consume the same contract. Malformed offsets, limits, and view names fail
loudly at the route/client boundary rather than silently returning a different
view.

## Constraints

- Keep the work inside the history module unless the provider protocol needs a
  small typed extension. Core should continue to own only shared provider
  payload types.
- Do not add a second conversation store or parallel history API. The existing
  `/history/:id`, `/api/history/:id`, and `HistoryClient.show` path should
  become the bounded detail path or delegate to one shared helper.
- Preserve resume behavior. `kota history resume` may still load full
  conversation state internally, but operator display paths should not fetch
  full transcripts by default.
- Keep message content shaping explicit. If a message body is truncated,
  callers should see the character bound and whether more content exists.
- Do not widen this into web/native history rendering fan-out; this task is the
  module contract and terminal proof only.

## Done When

- A long conversation can be read as metadata-only, as a bounded message
  window, and as explicit full state through the history module's daemon/API
  contract.
- The response shape includes message offset, limit, total message count, and
  per-message truncation status where content is bounded.
- `kota history show` has flags or another explicit operator path for choosing
  a bounded window, and its default display no longer requires loading every
  stored message just to render a small preview.
- Existing list, search, delete, reindex, semantic-unavailable, project-scope,
  and resume behavior remains intact.
- Tests cover at least: a 200+ message conversation, a middle-page read,
  metadata-only read, explicit full read, malformed offset/limit/view input,
  and the daemon-client decoder for each success arm.

## Source / Intent

Explorer run `2026-05-20T06-06-31-611Z-explorer-09lqz1` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add paged history detail views for large conversations" --state ready --area modules --priority p2 --summary "Extend the history module so daemon, API, and CLI callers can inspect long conversations through bounded summary/window/full views instead of always returning every stored message."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the workflow sandbox. This file was created through
the same repo-task format.

External source checked:

- `https://github.com/openai/codex/releases/tag/rust-v0.130.0` notes that
  app-server clients can page large threads with unloaded, summary, or full
  turn-item views.
- `https://github.com/openai/codex/releases/tag/rust-v0.131.0` keeps that
  app-server direction active while adding remote workflow and diagnostics
  work; no separate KOTA primitive is opened from those parts in this task.

Local evidence:

- `src/modules/history/client.ts` defines `HistoryShowResult` as full
  `ConversationData`.
- `src/modules/history/routes.ts` returns `provider.load(id)` directly from
  `/history/:id` and `/api/history/:id`.
- `src/modules/history/cli-commands.ts` calls `client.history.show(fullId)`
  before rendering truncated message previews.

## Initiative

History protocol scalability: long-running sessions should stay inspectable
through bounded, explicit reads rather than all-or-nothing transcript dumps.

## Acceptance Evidence

- Focused history module tests pass, for example:
  `pnpm test src/modules/history/routes.test.ts src/modules/history/daemon-client.test.ts src/modules/history/cli.test.ts`.
- A CLI transcript or committed fixture shows `kota history show` reading a
  long conversation through a bounded window and reporting the message window
  metadata.
- A route/client test fixture proves explicit full-state reads still work for
  resume-compatible callers while the bounded detail path avoids returning all
  messages.
