---
id: task-add-telegram-tasks-command-exposing-on-demand-sema
title: Add Telegram /tasks command exposing on-demand semantic task-queue search
status: done
priority: p2
area: modules
summary: Add a Telegram /tasks <query> command consuming the same daemon /api/tasks/search seam the new tasks-semantic provider exposes, with the shared renderRepoTaskSearchPlain helper and the semantic-unavailable / empty-result / empty-query branches the established cadence enforces, so an operator on Telegram can recall similar past or open repo tasks without context-switching to a terminal or browser.
created_at: 2026-04-27T05:57:05.496Z
updated_at: 2026-04-27T06:03:59.169Z
---

## Problem

The Telegram channel today exposes `/status`, `/digest`, `/attention`,
`/knowledge <query>`, `/memory <query>`, and `/history <query>`
(`src/modules/telegram/status-poll.ts`,
`src/modules/telegram/AGENTS.md`). Each of those search commands is a
thin wrapper over a daemon route that returns a typed envelope: the
three semantic seams (`/api/knowledge/search`, `/api/memory/search`,
`/api/history/search`) all use the discriminated `{ ok: true, ... } |
{ ok: false, reason: "semantic_unavailable" }` shape and a shared
`render*SearchPlain` helper.

The repo task queue is now the only major operator-and-autonomy-
relevant store with a semantic search seam (`tasks-semantic` module,
`/api/tasks/search` route, `ctx.client.tasks.search` namespace,
`kota task search` CLI subcommand) but no Telegram surface. An
operator in Telegram who wants to find similar past or open repo
tasks — "did we already do something about X?" — has to switch to a
terminal (`kota task search`), a browser, or a desktop client. That
breaks the established "every read seam reachable from Telegram"
cadence the five prior surfaces set.

## Desired Outcome

Telegram's `/tasks <query>` command calls the
`/api/tasks/search` route through `ctx.client.tasks.search` with
`semantic: true` by default, then renders the result through the
existing `renderRepoTaskSearchPlain` helper from
`src/modules/repo-tasks/render.ts`. The four operator-visible
branches surface one-to-one with the daemon contract:

- Per-task ranked rendered lines for non-empty results.
- A fixed empty-result body ("No matching tasks.") so the operator
  can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint
  (`Usage: /tasks <query>`) that skips the request, matching the
  `/knowledge`, `/memory`, and `/history` precedent.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search.

The command is allowlist-gated through the same chat-id check
`/digest`, `/attention`, `/knowledge`, `/memory`, and `/history`
already use; quiet hours intentionally do not gate it
(operator-initiated request).

## Constraints

- Implement the command in `src/modules/telegram/status-poll.ts`
  alongside the existing `/digest`, `/attention`, `/knowledge`,
  `/memory`, and `/history` branches. Do not add a sibling polling
  loop or a parallel command dispatch table.
- Reuse the `/api/tasks/search` route via `ctx.client.tasks.search`.
  Do not call the provider directly or bypass the daemon link.
- Use the shared `renderRepoTaskSearchPlain` helper from
  `src/modules/repo-tasks/render.ts`. No Telegram-specific render
  path; one render shape across CLI, web, macOS, mobile, and
  Telegram.
- Match the `/knowledge` / `/memory` / `/history` discipline: explicit
  empty-query usage hint, explicit empty-result body, explicit
  semantic-unavailable line.
- Keep the chat-allowlist gate. Quiet hours stay open.
- The command's daemon-down behavior matches the prior three commands:
  surface the daemon-unreachable error envelope plainly, do not
  pretend the result was empty.
- `src/modules/telegram/AGENTS.md` gains a `/tasks` section alongside
  the existing `/knowledge`, `/memory`, and `/history` sections,
  describing the route, the four branches, the allowlist gate, and
  the quiet-hours stance.

## Done When

- Telegram `/tasks <query>` returns per-task ranked rendered lines for
  non-empty results, the fixed empty-result body for no matches, the
  inline usage hint for empty queries, and the
  semantic-unavailable explanation when the configured `repo-tasks`
  provider does not support semantic search.
- `src/modules/telegram/status-poll.test.ts` covers the
  populated-results state, the empty-results state, the empty-query
  usage hint, the semantic-unavailable branch, and the chat-allowlist
  gate (mirroring the existing `/knowledge`, `/memory`, and `/history`
  test cases).
- `src/modules/telegram/AGENTS.md` describes `/tasks` at the same
  conventions level as the existing `/knowledge`, `/memory`, and
  `/history` sections.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

This task is the Telegram step in the repo-task-queue semantic search
fan-out opened by the seed task `task-add-embedding-backed-semantic-
search-to-the-repo-t` (the `tasks-semantic` module landed in
`7bd41ed7`, exposing `/api/tasks/search` and `kota task search`).
The cadence Telegram → macOS DaemonClient → macOS menu bar → mobile
that the three prior memory / knowledge / history semantic seams
established places the Telegram surface as the first operator-facing
client step after the daemon route and CLI land.

## Initiative

Repo-task-queue semantic search seam fan-out — match the
memory/knowledge/history multi-surface client coverage so the
on-demand semantic task-queue search the daemon serves is reachable
from every operator surface, including Telegram, without context-
switching to another client. This closes the "semantic recall
reachable from any operator surface" gap for the last major repo
store.

## Acceptance Evidence

- A captured Telegram transcript or test fixture showing `/tasks
  <query>` returning the four envelope branches against the same
  daemon route the CLI consumes.
- A short rendered-output sample showing line-shape parity with the
  CLI `kota task search` output and the existing `/memory`,
  `/knowledge`, and `/history` Telegram bodies.
- Test output showing the new `status-poll.test.ts` cases pass.
