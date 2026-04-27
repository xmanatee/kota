---
id: task-add-kota-history-search-cli-semantic-search-subcom
title: Add kota history search CLI semantic search subcommand consuming /api/history/search
status: backlog
priority: p2
area: modules
summary: Add a `kota history search <query>` subcommand that calls ctx.client.history.search through the new /api/history/search route, defaulting to semantic search and printing the per-conversation render the established memory/knowledge subcommands emit, so operators can pull semantic conversation recall from the terminal without scraping history index files.
created_at: 2026-04-27T03:01:43.081Z
updated_at: 2026-04-27T03:01:43.081Z
---

## Problem

Once `task-add-daemon-http-apihistorysearch-semantic-search-r`
ships the `/api/history/search` route and the `KotaClient.history.search`
namespace method, terminal operators still have no `kota history search`
subcommand to call it. Today the `history` CLI module exposes
`kota history list`, `kota history show`, `kota history delete`, and
`kota history clear` (`src/modules/history/cli.ts`), but the only way
to find a prior conversation by content is `kota history list --search
<keyword>` against title/text matches in the index — no semantic
ranking.

The memory and knowledge surfaces use a separate `search` subcommand
(`kota memory search <query>`, `kota knowledge search <query>`) that
default to semantic and surface the discriminated `semantic_unavailable`
branch explicitly rather than silently degrading. The same affordance
is missing for history.

## Desired Outcome

Running `kota history search <query>` calls the new
`/api/history/search` route through `ctx.client.history.search` with
`semantic: true` by default, and prints the same per-conversation
render the established memory/knowledge subcommands emit (one line per
conversation: id-shortcut, title or first-message snippet, message
count, timestamp). The four operator-visible branches surface
one-to-one with the daemon contract:

- Per-conversation rendered lines for non-empty results.
- A fixed empty-result body ("No matching conversations.") so the
  operator can distinguish "nothing matched" from "command failed".
- A whitespace-only / empty-query inline usage hint that skips the
  request.
- A semantic-unavailable explanation surfaced explicitly — never a
  silent degrade to keyword search. `--keyword` (or `--no-semantic`)
  opts into the keyword path explicitly when the operator wants it.

A `--json` flag emits the structured `{ ok, conversations | reason }`
payload via `process.stdout.write(JSON.stringify(...))` per the
rendering module's structured-surface contract.

## Constraints

- Implement the subcommand inside `src/modules/history/cli.ts`
  alongside the existing list/show/delete/clear subcommands. Do not
  add a sibling CLI file or a parallel command registration path.
- Reuse the `/api/history/search` route via
  `ctx.client.history.search`. Do not call the provider directly or
  bypass the daemon link.
- Human-facing output flows through `src/modules/rendering/` (`text` +
  `plain` + `print`). The `--json` path uses
  `process.stdout.write(JSON.stringify(...))` per the rendering
  module's contract on structured surfaces.
- Mirror the per-conversation render shape across surfaces: ship a
  `renderHistorySearchPlain` helper in `src/modules/history/render.ts`
  (matching `memory/render.ts` and `knowledge/render.ts`) and consume
  it from CLI + the upcoming Telegram surface. No third format.
- Match the memory/knowledge subcommand discipline: an explicit
  empty-query usage hint, an explicit empty-result body, and an
  explicit semantic-unavailable line.
- Do not break the existing `kota history list --search <keyword>`
  keyword path; that subcommand stays as-is.
- No legacy or compatibility surface. The semantic-default behavior is
  the only behavior; keyword opt-in is a flag.

## Done When

- `kota history search <query>` calls `ctx.client.history.search` with
  `semantic: true` by default and renders per-conversation lines for
  non-empty results.
- The empty-results state, empty-query usage hint, and
  semantic-unavailable branch each render the established fixed body.
- `--keyword` (or `--no-semantic`) routes through the keyword search
  path; `--json` emits the structured payload.
- `src/modules/history/cli.test.ts` covers the populated-results
  state, the empty-results state, the empty-query usage hint, the
  semantic-unavailable branch, the keyword-flag branch, and the
  `--json` path.
- `src/modules/history/render.ts` ships `renderHistorySearchPlain`
  matching the `renderMemorySearchPlain` /
  `renderKnowledgeSearchPlain` shape, and the CLI consumes it.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

This task is the terminal step in the conversation/recall seam fan-out
opened by `task-add-daemon-http-apihistorysearch-semantic-search-r`,
mirroring the just-completed memory fan-out (commit `6843b9f4`,
`task-add-mobile-memoryscreen-consuming-searchmemory`) and the prior
knowledge / digest / attention surfaces. The cadence Telegram → CLI →
daemon HTTP → web → macOS → mobile that the four prior seams
established makes the CLI subcommand the natural next step after the
daemon route lands.

## Initiative

Conversation/recall seam fan-out — match the memory/knowledge multi-
surface client coverage so the on-demand semantic conversation search
the daemon serves is reachable from every operator surface.

## Acceptance Evidence

- A captured terminal transcript showing `kota history search`
  returning per-conversation results, empty results, the empty-query
  usage hint, and the `semantic_unavailable` branch on a daemon with
  no semantic provider configured.
- A short rendered-output sample showing line-shape parity with `kota
  memory search` and `kota knowledge search`.
- Test output showing the new CLI test cases pass.
