---
id: task-add-telegram-history-command-exposing-on-demand-se
title: Add Telegram /history command exposing on-demand semantic conversation search
status: backlog
priority: p2
area: modules
summary: Add a Telegram `/history <query>` command consuming the same daemon /api/history/search seam Telegram /memory and /knowledge already use, with the shared history-render helper and the semantic-unavailable / empty-result / empty-query branches the established cadence enforces, so an operator on Telegram can recall prior conversations without context-switching to a terminal or browser.
created_at: 2026-04-27T03:01:46.082Z
updated_at: 2026-04-27T03:01:46.082Z
---

## Problem

The Telegram channel today exposes `/status`, `/digest`, `/attention`,
`/knowledge <query>`, and `/memory <query>` (`src/modules/telegram/
status-poll.ts`, `src/modules/telegram/AGENTS.md`). Each of those
commands is a thin wrapper over a daemon route that returns a typed
envelope: `/digest` and `/attention` over the on-demand digest steps,
`/knowledge` and `/memory` over `/api/knowledge/search` and
`/api/memory/search` with the discriminated `{ ok: true, entries } | {
ok: false, reason: "semantic_unavailable" }` envelope and the shared
`renderKnowledgeSearchPlain` / `renderMemorySearchPlain` helpers.

There is no `/history <query>` command. An operator in Telegram who
wants to recall what was discussed in a prior conversation has to
switch to a terminal (`kota history list --search`), a browser (web
client `HistoryList`), or a desktop client. That breaks the established
"every read seam reachable from Telegram" cadence the four prior
surfaces set.

## Desired Outcome

Telegram's `/history <query>` command calls the new
`/api/history/search` route through `ctx.client.history.search` with
`semantic: true` by default, then renders the result through a shared
`renderHistorySearchPlain` helper (or whatever shape the CLI/macOS/
mobile fan-outs adopt for line parity). The four operator-visible
branches surface one-to-one with the daemon contract:

- Per-conversation rendered lines for non-empty results.
- A fixed empty-result body ("No matching conversations.") so the
  operator can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint
  (`Usage: /history <query>`) that skips the request, matching the
  `/knowledge` and `/memory` precedent.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search.

The command is allowlist-gated through the same chat-id check
`/digest`, `/attention`, `/knowledge`, and `/memory` already use; quiet
hours intentionally do not gate it (operator-initiated request).

## Constraints

- Implement the command in `src/modules/telegram/status-poll.ts`
  alongside the existing `/digest`, `/attention`, `/knowledge`, and
  `/memory` branches. Do not add a sibling polling loop or a parallel
  command dispatch table.
- Reuse the `/api/history/search` route via
  `ctx.client.history.search`. Do not call the provider directly or
  bypass the daemon link.
- Use the shared `renderHistorySearchPlain` helper from
  `src/modules/history/render.ts` (added by the CLI follow-up). No
  Telegram-specific render path; one render shape across CLI, web,
  macOS, mobile, and Telegram.
- Match the `/knowledge` / `/memory` discipline: explicit empty-query
  usage hint, explicit empty-result body, explicit
  semantic-unavailable line.
- Keep the chat-allowlist gate. Quiet hours stay open.
- The command's daemon-down behavior matches `/knowledge` and
  `/memory`: surface the daemon-unreachable error envelope plainly,
  do not pretend the result was empty.
- `src/modules/telegram/AGENTS.md` gains a `/history` section
  alongside the existing `/knowledge` and `/memory` sections,
  describing the route, the four branches, the allowlist gate, and
  the quiet-hours stance.

## Done When

- Telegram `/history <query>` returns per-conversation rendered lines
  for non-empty results, the fixed empty-result body for no matches,
  the inline usage hint for empty queries, and the
  semantic-unavailable explanation when the configured history
  provider does not support semantic search.
- `src/modules/telegram/status-poll.test.ts` covers the
  populated-results state, the empty-results state, the empty-query
  usage hint, the semantic-unavailable branch, and the chat-allowlist
  gate (mirroring the existing `/knowledge` / `/memory` test cases).
- `src/modules/telegram/AGENTS.md` describes `/history` at the same
  conventions level as the existing `/knowledge` and `/memory`
  sections.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

This task is the Telegram step in the conversation/recall seam
fan-out opened by `task-add-daemon-http-apihistorysearch-semantic-search-r`
and continued by the CLI follow-up. The cadence Telegram → CLI →
daemon HTTP → web → macOS → mobile that the four prior memory /
knowledge / digest / attention seams established places the Telegram
surface alongside the CLI as the first operator-facing step after the
daemon route lands.

## Initiative

Conversation/recall seam fan-out — match the memory/knowledge multi-
surface client coverage so the on-demand semantic conversation search
the daemon serves is reachable from every operator surface, including
Telegram, without context-switching to another client.

## Acceptance Evidence

- A captured Telegram transcript or test fixture showing `/history
  <query>` returning the four envelope branches against the same
  daemon route the CLI consumes.
- A short rendered-output sample showing line-shape parity with the
  CLI `kota history search` output and the existing `/memory` /
  `/knowledge` Telegram bodies.
- Test output showing the new `status-poll.test.ts` cases pass.
