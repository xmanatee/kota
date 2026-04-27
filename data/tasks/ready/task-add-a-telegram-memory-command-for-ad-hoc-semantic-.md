---
id: task-add-a-telegram-memory-command-for-ad-hoc-semantic-
title: Add a Telegram /memory command for ad-hoc semantic memory search
status: ready
priority: p2
area: client
summary: Mirror the /knowledge command for the memory store: parse the message body as the query, call ctx.client.memory.search(query, { semantic: true, limit: 10 }) through the daemon-control client, render the same id/date/content line shape produced by buildMemoryListLines, and surface the four operator-visible branches (populated, empty-results, empty-query-hint, semantic-unavailable) one-to-one with the daemon contract — opening the operator-pull memory fan-out across Telegram, CLI (already done), daemon HTTP (already done), web, macOS, and mobile.
created_at: 2026-04-27T00:44:59.556Z
updated_at: 2026-04-27T00:44:59.556Z
---

## Problem

The `memory` module already exposes a substantial operator-facing seam:
`kota memory {list, search, show, add, delete, reindex, ...}`
(`src/modules/memory/cli.ts`), `GET /api/memory` plus
`GET /api/memory/search` plus `POST /api/memory/reindex` and the per-id
routes (`src/modules/memory/routes.ts`), and an embedded web
`MemoryPanel` (`clients/web/src/components/sidebar/MemoryPanel.tsx`) that
currently shows recent entries with a simple substring filter rather
than semantic ranking. Embedding-backed semantic search is wired through
the `memory-semantic` provider when configured
(`src/modules/memory-semantic/`), with keyword fallback otherwise. The
`/api/memory/search` route returns the discriminated shape
`{ ok: true, entries: [{id, created, content}] } | { ok: false, reason: "semantic_unavailable" }`
so callers do not silently degrade to keyword search behind the
operator's back.

The Telegram channel today exposes `/status`, `/digest`, `/attention`,
and `/knowledge` (`src/modules/telegram/status-poll.ts`,
`src/modules/telegram/AGENTS.md`). An operator on a phone has no way to
query KOTA's memory store from Telegram — they have to switch to the
web client or shell. With `/digest`, `/attention`, and `/knowledge`
already backing four-plus surfaces each (Telegram → CLI → daemon HTTP →
web → macOS → mobile), `memory` is the next substantial seam to fan
out, and Telegram is the established starting surface in that cadence
(the inbound notification + ad-hoc-pull surface the operator already
uses for KOTA).

## Desired Outcome

The `telegram-status` channel learns one new command, `/memory <query>`:

- Parsing: text starts with `/memory `, the remainder is the query
  string. Empty query (`/memory` alone) replies with a short usage hint
  ("Usage: /memory <query>") and does not call the store.
- Execution: calls `ctx.client.memory.search(query, { semantic: true,
  limit: 10 })` through the same daemon-control client surface
  `/digest`, `/attention`, and `/knowledge` consume — semantic ranking
  when an embedding-backed memory provider is configured, keyword
  fallback otherwise. The `result.ok === false` branch (semantic
  requested but no provider) replies with a short explanation and does
  not retry without semantic.
- Rendering: emits the top entries as a plain-text block — one line per
  entry showing id, created date, and a short content snippet
  (mirroring `buildMemoryListLines` in `src/modules/memory/cli.ts`);
  empty result replies with a short fixed body ("No matching memory
  entries.") so operators can distinguish "nothing matched" from
  "command failed". The body fits the existing 4096-char Telegram
  truncation contract (`truncateForTelegram`).
- Authorization: the same allowlist that gates `/digest`, `/attention`,
  and `/knowledge` (`String(msg.chat.id) !== chatId` on the configured
  status chat) gates `/memory`. Disallowed chats are silently ignored,
  exactly like the existing commands.
- AGENTS.md: `src/modules/telegram/AGENTS.md` is extended to describe
  `/memory` alongside `/digest`, `/attention`, and `/knowledge`. Like
  the existing on-demand commands the `/memory` reply is
  operator-facing only and must not be exposed to autonomy agents in
  any prompt path.

## Constraints

- Reuse `ctx.client.memory.search` — do not introduce a second memory
  access path on the Telegram side, do not hit the file store directly,
  and do not duplicate the search/render logic from
  `src/modules/memory/cli.ts`. If the rendering shape must be shared
  with Telegram, lift it into a small helper inside the `memory`
  module rather than copying it into `telegram/`.
- Do not gate `/memory` by quiet hours. It is operator-initiated and
  replies in-band, exactly like `/digest`, `/attention`, and
  `/knowledge`.
- Do not advance any cadence/counter file or emit a workflow event for
  the operator-initiated query. `/memory` is a pure ad-hoc pull.
- Strict argument parsing: empty query and whitespace-only query must
  produce the usage hint, not an empty search.
- The semantic-unavailable branch must surface explicitly to the
  operator (one-line reply explaining the embedding provider is not
  configured); it must not silently degrade to keyword search behind
  the operator's back.
- Telegram message formatting must remain plain text — memory content
  can contain Markdown-active characters; do not add
  `parse_mode: "Markdown"` for the reply.
- Allowlist enforcement is non-negotiable. Add a test that proves
  `/memory` from a chat outside the allowlist is dropped, mirroring
  the existing `/digest`, `/attention`, and `/knowledge` allowlist
  tests in `src/modules/telegram/status-poll.test.ts`.

## Done When

- `src/modules/telegram/status-poll.ts` handles `/memory <query>`
  alongside the existing `/status`, `/digest`, `/attention`, and
  `/knowledge` branches.
- New tests in `src/modules/telegram/status-poll.test.ts` cover: a
  successful search reply with a query that returns entries, an empty-
  result reply, the empty/whitespace-only query usage hint, the
  semantic-unavailable explicit reply, and allowlist rejection from a
  disallowed chat.
- `src/modules/telegram/AGENTS.md` describes `/memory` alongside
  `/digest`, `/attention`, and `/knowledge`.
- `pnpm --filter kota typecheck`, `pnpm --filter kota test
  src/modules/telegram`, and `pnpm --filter kota test
  src/modules/memory` are green.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0) follows the just-shipped
mobile KnowledgeScreen (commit `48674b03`), which closed the knowledge
seam fan-out across CLI, daemon HTTP, web, Telegram, macOS, and mobile.
The daily-digest and attention fan-outs closed the previous two weeks.
With three on-demand pull seams complete, the memory module is the next
substantial operator-facing seam without cross-surface parity: `kota
memory`, `GET /api/memory[/search]`, and the keyword-only web
`MemoryPanel` already exist; Telegram, macOS menu bar, and mobile do
not yet expose memory at all. The previously established cadence is
Telegram-first (`/digest` was the first surface in the daily-digest
fan-out; `/attention` was the first in the attention fan-out;
`/knowledge` was the first in the knowledge fan-out), so this task
opens the memory fan-out at the same surface and follows the same
template.

## Initiative

Memory surface fan-out across operator client surfaces — extend the
existing CLI + daemon HTTP + keyword-only web `MemoryPanel` memory seam
to Telegram, macOS menu bar, and mobile (and add semantic search to the
web panel), mirroring the completed daily-digest, attention, and
knowledge fan-outs so operators can browse and semantically search the
agent memory store from any surface they already use to supervise KOTA.

## Acceptance Evidence

- A captured `pnpm --filter kota test src/modules/telegram` run showing
  the new `/memory` cases (success, empty result, usage hint,
  semantic-unavailable, allowlist rejection) green alongside the
  existing `/digest`/`/attention`/`/knowledge`/`/status` cases.
- A short transcript or fixture showing the rendered `/memory <query>`
  body for one query that returns entries and one that returns no
  matches, demonstrating the line shape and the empty-state copy.
