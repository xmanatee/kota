---
id: task-add-telegram-recall-command-exposing-the-unified-c
title: Add Telegram /recall command exposing the unified cross-store recall seam
status: done
priority: p2
area: modules
summary: Add a Telegram /recall <query> command that consumes the unified cross-store recall seam (knowledge, memory, history, tasks) and renders one ranked, source-tagged result list, mirroring the established Telegram per-store search commands but querying every store in one call.
created_at: 2026-04-27T07:42:23.045Z
updated_at: 2026-04-27T07:55:05.506Z
---

## Problem

The unified cross-store recall seam landed at commit `09d60ce3` with a
`RecallProvider` primitive, a daemon HTTP route, the
`KotaClient.recall.recall(query, filters?)` namespace, and a
`kota recall <query>` CLI subcommand. The seam intentionally shipped
without channel/client adoption so it would not seed another
five-surface fan-out chain. The next single substantive follow-up is
the highest-leverage operator-facing surface: chat.

The Telegram bot already exposes four per-store search commands —
`/knowledge`, `/memory`, `/history`, `/tasks` — each a thin wrapper
over its own semantic-search namespace. To recall something today the
operator must already know which store the answer lives in, type the
matching command, and accept that hits in other stores stay invisible.
That is the inverse of how a personal assistant should answer "what do
I know / remember / have done / am tracking about X?". Chat is where
ad-hoc recall queries actually happen (most often from a phone), so
chat is the surface that benefits most from one ranked, source-tagged
result list across every store.

## Desired Outcome

- The Telegram channel exposes a `/recall <query>` command, registered
  alongside the existing `/knowledge`, `/memory`, `/history`, and
  `/tasks` commands and gated by the same chat allowlist.
- The command is a thin wrapper over `ctx.client.recall.recall(query,
  filters?)` — no parallel embedding plumbing, no second ranking step,
  no per-store fan-out logic in the Telegram module. The seam already
  owns merge, normalize, and ranking.
- Results render as one ranked list with each row tagged by its source
  store (e.g. `[knowledge]`, `[memory]`, `[history]`, `[tasks]`) plus
  a short preview/title and an identifier the operator can reuse with
  the per-store command if they want to drill in.
- Empty-query, empty-result, and "semantic search unavailable" branches
  emit explicit, distinguishable messages so the operator can tell
  "nothing matched" apart from "the seam is not configured", matching
  the pattern the per-store commands already use.
- The per-store commands stay as-is. `/recall` is additive — it
  augments the chat surface with a "search everything" entry point but
  does not replace the focused per-store paths.

## Constraints

- One mechanism. The command consumes the existing `recall` namespace
  on `KotaClient`; it does not introduce a second cross-store query
  path or a second ranking implementation.
- Strict typed protocols. The renderer consumes the seam's typed
  `RecallHit` discriminated union directly and exhaustively switches on
  the `source` tag with no `default` branch. No optional fields, no
  silent fallbacks, no per-store nullability shims in the Telegram
  layer.
- The Telegram module must not import from `#modules/recall` directly
  for runtime behavior beyond the `KotaClient` namespace it already
  consumes. If a runtime dependency on the recall module is genuinely
  required (e.g. for a typed render helper exported there), declare it
  in the Telegram `KotaModule.dependencies` array.
- Chat-allowlist gating only. Do not gate `/recall` behind quiet hours
  — recall is a pull/read action, not a notification, matching the
  per-store search commands.
- No legacy or compatibility shim. `/recall` ships as the only Telegram
  surface for cross-store recall.

## Done When

- A new `/recall <query>` command is registered in the Telegram bot
  command set, with a thin handler that calls
  `ctx.client.recall.recall(query, filters?)` and renders the typed
  response.
- The renderer (either co-located with the Telegram handler or a
  helper in the recall module's render surface) outputs one ranked
  list whose rows are source-tagged, exhaustively covering every
  variant of `RecallHit`.
- Empty-query, empty-result, and seam-unavailable branches each emit a
  distinct, fixed body so the operator can disambiguate them, matching
  the existing per-store commands' wording style.
- Tests cover: (a) the command-registration path, (b) the
  rendering of a mixed-store synthetic fixture, including stable
  source-tag ordering and tie-breaking, (c) the empty-query /
  empty-result / seam-unavailable branches, (d) the chat-allowlist
  gate.
- The Telegram module's `AGENTS.md` lists `/recall` alongside the
  per-store commands and notes it as the unified-recall entry point;
  no per-store routing or wire-format duplication.
- A captured Telegram transcript (or equivalent test fixture) under
  the run directory shows `/recall <query>` returning ranked,
  source-tagged hits from at least two different stores.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

The unified cross-store recall seam landed at commit `09d60ce3` (see
`task-add-a-unified-cross-store-recall-seam-returning-ra.md`). That
seam task explicitly scoped surface adoption — Telegram, macOS,
mobile, web — out of the seam itself and called for them to land later
as honest single-task follow-ups, not as a parallel five-surface
fan-out chain. Chat is the highest-leverage first surface for a
personal-assistant recall query, since most ad-hoc "what do I know /
remember / have done about X?" queries happen from the operator's
phone. This task is that first single follow-up; macOS, mobile, and
web adoption are intentionally left for separate substantive tasks.

## Initiative

Personal-assistant retrieval. KOTA should answer one operator query
across every store it owns, returning one ranked, source-tagged result
list, without forcing the operator to pre-classify the question.
Bringing this experience to the chat surface — where most personal
queries actually originate — is the next demonstration of the seam's
value.

## Acceptance Evidence

- Diff covering the new Telegram `/recall` command registration,
  handler, render path, tests, and module `AGENTS.md` update.
- Unit tests for the rendered output against a synthetic mixed-store
  fixture, the empty-query / empty-result / seam-unavailable branches,
  and the chat-allowlist gate.
- A transcript fixture (or captured chat reply) under the run
  directory showing `/recall <query>` returning ranked, source-tagged
  hits from at least two stores.
