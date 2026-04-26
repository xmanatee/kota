---
id: task-add-a-telegram-knowledge-command-for-ad-hoc-semant
title: Add a Telegram /knowledge command for ad-hoc semantic knowledge search
status: done
priority: p2
area: modules
summary: Add a Telegram /knowledge <query> command that runs against ctx.client.knowledge.search and emits the matching entries inline, opening the operator-facing knowledge seam on the messaging surface in the same Telegram-first cadence the daily-digest and attention-digest seams established.
created_at: 2026-04-26T09:43:58.020Z
updated_at: 2026-04-26T09:54:48.328Z
---

## Problem

The `knowledge` module already exposes a substantial operator-facing
seam: `kota knowledge {list, search, show, add, delete, export, reindex,
import}` (`src/modules/knowledge/cli.ts`), `GET /api/knowledge` plus
`GET /api/knowledge/search` plus `POST /api/knowledge/reindex` and the
per-id routes (`src/modules/knowledge/routes.ts`), and an embedded web
`KnowledgePanel` (`clients/web/src/components/sidebar/KnowledgePanel.tsx`).
Semantic ranking is wired through the `knowledge-semantic` provider when
configured, with keyword fallback otherwise.

The Telegram channel today exposes only `/status`, `/digest`, and
`/attention` (`src/modules/telegram/status-poll.ts:122-128`,
`src/modules/telegram/AGENTS.md`). An operator on a phone has no way to
query KOTA's knowledge store from Telegram — they have to switch to the
web client or shell. With `/digest` and `/attention` now backing four
surfaces each (Telegram → CLI → daemon HTTP → web → macOS → mobile →
push), knowledge is the next substantial seam to fan out, and Telegram
is the established starting surface in that cadence (the inbound
notification + ad-hoc-pull surface the operator already uses for KOTA).

## Desired Outcome

The `telegram-status` channel learns one new command, `/knowledge <query>`:

- Parsing: text starts with `/knowledge `, the remainder is the query
  string. Empty query (`/knowledge` alone) replies with a short usage
  hint ("Usage: /knowledge <query>") and does not call the store.
- Execution: calls `ctx.client.knowledge.search(query, { semantic: true,
  limit: 10 })` through the same daemon-control client surface
  `/digest` and `/attention` consume — semantic ranking when an
  embedding-backed knowledge provider is configured, keyword fallback
  otherwise. The `result.ok === false` branch (semantic requested but
  no provider) replies with a short explanation and does not retry
  without semantic.
- Rendering: emits the top entries as a plain-text block — one line per
  entry showing id, type, status, and title (mirroring
  `buildKnowledgeSearchLines` in `src/modules/knowledge/cli.ts`); empty
  result replies with a short fixed body ("No matching knowledge
  entries.") so operators can distinguish "nothing matched" from
  "command failed". The body fits the existing 4096-char Telegram
  truncation contract (`truncateForTelegram`).
- Authorization: the same allowlist that gates `/digest` and
  `/attention` (`String(msg.chat.id) !== chatId` on the configured
  status chat) gates `/knowledge`. Disallowed chats are silently
  ignored, exactly like the existing commands.
- AGENTS.md: `src/modules/telegram/AGENTS.md` is extended to describe
  `/knowledge` alongside `/digest` and `/attention`. Like the existing
  on-demand commands the `/knowledge` reply is operator-facing only and
  must not be exposed to autonomy agents in any prompt path.

## Constraints

- Reuse `ctx.client.knowledge.search` — do not introduce a second
  knowledge access path on the Telegram side, do not hit the file store
  directly, and do not duplicate the search/render logic from
  `src/modules/knowledge/cli.ts`. If the rendering shape must be shared
  with Telegram, lift it into a small helper inside the `knowledge`
  module rather than copying it into `telegram/`.
- Do not gate `/knowledge` by quiet hours. It is operator-initiated and
  replies in-band, exactly like `/digest` and `/attention`.
- Do not advance any cadence/counter file or emit a workflow event for
  the operator-initiated query. `/knowledge` is a pure ad-hoc pull.
- Strict argument parsing: empty query and whitespace-only query must
  produce the usage hint, not an empty search.
- The semantic-unavailable branch must surface explicitly to the
  operator (one-line reply explaining the embedding provider is not
  configured); it must not silently degrade to keyword search behind
  the operator's back.
- Telegram message formatting must remain plain text — knowledge titles
  and content can contain Markdown-active characters; do not add
  `parse_mode: "Markdown"` for the reply.
- Allowlist enforcement is non-negotiable. Add a test that proves
  `/knowledge` from a chat outside the allowlist is dropped, mirroring
  the existing `/digest` and `/attention` allowlist tests in
  `src/modules/telegram/status-poll.test.ts`.

## Done When

- `src/modules/telegram/status-poll.ts` handles `/knowledge <query>`
  alongside the existing `/status`, `/digest`, and `/attention`
  branches.
- New tests in `src/modules/telegram/status-poll.test.ts` cover: a
  successful search reply with a query that returns entries, an empty-
  result reply, the empty/whitespace-only query usage hint, the
  semantic-unavailable explicit reply, and allowlist rejection from a
  disallowed chat.
- `src/modules/telegram/AGENTS.md` describes `/knowledge` alongside
  `/digest` and `/attention`.
- `pnpm --filter kota typecheck`, `pnpm --filter kota test
  src/modules/telegram`, and `pnpm --filter kota test
  src/modules/knowledge` are green.
- Repo validation (`pnpm --filter kota run validate:tasks` or the
  workflow's standard check) passes.

## Source / Intent

The empty `ready/` queue (counts.ready=0) follows the just-shipped
mobile AttentionScreen + push deep-link extension (commit `a590afb8`),
which closed the attention seam fan-out across all seven operator
surfaces. The daily-digest fan-out closed the same week. With both
on-demand pull seams complete, the knowledge module is the next
substantial operator-facing seam without cross-surface parity:
`kota knowledge`, `GET /api/knowledge[/search]`, and the web
`KnowledgePanel` already exist; Telegram, macOS menu bar, and mobile do
not yet expose it. The previously established cadence is Telegram-first
(`/digest` was the first surface in the daily-digest fan-out;
`/attention` was the first in the attention fan-out), so this task
opens the knowledge fan-out at the same surface and follows the same
template.

## Initiative

Knowledge surface fan-out across operator client surfaces — extend the
existing CLI + daemon HTTP + web `KnowledgePanel` knowledge seam to
Telegram, macOS menu bar, and mobile, mirroring the completed daily-
digest and attention-digest fan-outs so operators can browse and search
the project knowledge store from any surface they already use to
supervise KOTA.

## Acceptance Evidence

- A captured `pnpm --filter kota test src/modules/telegram` run showing
  the new `/knowledge` cases (success, empty result, usage hint,
  semantic-unavailable, allowlist rejection) green alongside the
  existing `/digest`/`/attention`/`/status` cases.
- A short transcript or fixture showing the rendered `/knowledge
  <query>` body for one query that returns entries and one that returns
  no matches, demonstrating the line shape and the empty-state copy.
