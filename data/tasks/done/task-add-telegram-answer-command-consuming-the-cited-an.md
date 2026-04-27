---
id: task-add-telegram-answer-command-consuming-the-cited-an
title: Add Telegram /answer command consuming the cited-answer seam
status: done
priority: p2
area: modules
summary: Add a Telegram /answer <query> command that consumes the cited-answer seam (KotaClient.answer) and renders one short prose answer followed by a typed citation list, mirroring the established Telegram /recall and per-store search commands. First single honest surface follow-up of the answer seam; macOS, mobile, and web adoption land later as separate tasks.
created_at: 2026-04-27T11:10:27.684Z
updated_at: 2026-04-27T11:23:15.264Z
---

## Problem

The cited-answer seam landed at commit `082c565f` with an
`AnswerProvider` primitive, a `POST /api/answer` daemon route, the
`KotaClient.answer.answer(query, filter?)` namespace, and a
`kota answer <query>` CLI subcommand. The seam intentionally shipped
without channel/client adoption so it would not seed another
five-surface fan-out chain (see the `## Initiative` section of
`task-add-a-cited-answer-seam-on-top-of-cross-store-reca.md`).

The Telegram bot already exposes `/recall` as the unified cross-store
*search* entry point (commit `6510f998`). What it does not yet expose
is `/answer` — the natural next chat capability. Today, recalling
something from a phone returns three to ten ranked source rows; the
operator must read them and synthesize the answer themselves. Chat is
where ad-hoc personal-assistant queries actually originate (most often
from a phone), so chat is also where a one-shot composed answer with
typed citations is most valuable. `/recall` and `/answer` are
complementary: `/recall` returns the source pile, `/answer` returns the
resolved question with citations back into that pile.

## Desired Outcome

- The Telegram channel exposes an `/answer <query>` command, registered
  alongside the existing `/recall`, `/knowledge`, `/memory`, `/history`,
  and `/tasks` commands and gated by the same chat allowlist.
- The command is a thin wrapper over `ctx.client.answer.answer(query,
  filter?)` — no parallel synthesis prompt, no second citation parser,
  no per-store fan-out logic in the Telegram module. The seam already
  owns retrieval delegation, synthesis, citation parsing, and the
  one-retry policy.
- The reply renders the synthesized prose first, followed by a typed
  citation block listing each cited source by its `[source:id]` marker,
  short title/preview, and rank score. Citations resolve back to the
  typed `RecallHit[]` returned in the same response — no broken
  pointers ever reach the operator (the seam already guarantees this
  before returning).
- The three `ok: false` reasons (`no_hits`, `semantic_unavailable`,
  `synthesis_failed`) each emit a distinct, fixed-body message so the
  operator can disambiguate "nothing matched" from "the seam is not
  configured" from "the model could not compose a cited answer",
  matching the pattern `/recall` already uses for its own degradation
  branches.
- `/recall` stays as-is. `/answer` is additive — it augments chat with a
  composed-answer entry point but does not replace the unified-recall
  list view; both commands have distinct operator value.

## Constraints

- One mechanism. The command consumes the existing `answer` namespace
  on `KotaClient`; it does not introduce a second synthesis path, a
  second citation parser, a second prompt, or a per-store fan-out
  ranking.
- Strict typed protocols. The renderer consumes the seam's discriminated
  `AnswerResult` union exhaustively (`ok: true` and the three
  `ok: false` reasons) with no `default` branch. The `AnswerCitation[]`
  is rendered by direct iteration with exhaustive switch on the
  citation source. No optional fields, no silent fallbacks, no
  per-store nullability shims in the Telegram layer.
- The Telegram module must not import from `#modules/answer` directly
  for runtime behavior beyond the typed `KotaClient.answer` namespace it
  consumes. If a typed render helper from the answer module is reused
  (e.g. `renderAnswerCitationsPlain` from `src/modules/answer/render.ts`),
  declare `answer` in the Telegram `KotaModule.dependencies` array
  alongside the existing dependencies.
- Chat-allowlist gating only. Do not gate `/answer` behind quiet hours
  — answer is a pull/read action initiated by the operator, not a
  notification. Matches `/recall` and the per-store search commands.
- One model call per `/answer` invocation by default. The seam may
  internally retry once on malformed-citation output (its existing
  contract); the Telegram handler must not add a second retry layer or
  any per-message budget enforcement.
- Cost signals do not flow back to the operator chat reply. Match the
  existing repo standing rule: no per-query cost dashboard, no token
  count surfaced into the chat message.
- No legacy or compatibility shim. `/answer` ships as the only Telegram
  surface for cited-answer composition. The reply format is the only
  format; no opt-in flag, no v2 path.

## Done When

- A new `/answer <query>` command is registered in the Telegram bot
  command set (alongside `/recall`, `/knowledge`, `/memory`,
  `/history`, `/tasks`), with a thin handler that calls
  `ctx.client.answer.answer(query, filter?)` and renders the typed
  response.
- The renderer (either co-located with the Telegram handler or a
  helper exported from `src/modules/answer/render.ts` and reused) emits
  one Telegram reply containing the prose answer followed by the
  citation block, exhaustively covering every `AnswerCitation` source
  variant.
- The empty-query, `no_hits`, `semantic_unavailable`, and
  `synthesis_failed` branches each emit a distinct, fixed body so the
  operator can disambiguate them, matching the existing `/recall` and
  per-store commands' wording style.
- Tests cover: (a) the command-registration path, (b) the rendering of
  a synthesized-answer-plus-citations fixture spanning at least two
  source arms, (c) the empty-query / `no_hits` /
  `semantic_unavailable` / `synthesis_failed` branches, (d) the
  chat-allowlist gate.
- The Telegram module's `AGENTS.md` lists `/answer` alongside the
  existing commands and notes that it is the cited-answer composition
  surface (one prose answer plus typed citations), not a second recall
  path. The module's `dependencies` array gains `answer` if the render
  helper is reused.
- A captured Telegram transcript (or equivalent test fixture) under the
  run directory shows `/answer <query>` returning a composed answer
  with at least two citations across two source arms.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

The cited-answer seam landed at commit `082c565f` (see
`task-add-a-cited-answer-seam-on-top-of-cross-store-reca.md`). That
seam task explicitly scoped surface adoption — Telegram, macOS,
mobile, web — out of the seam itself and called for them to land later
as honest single-task follow-ups, not as a parallel five-surface
fan-out chain. Chat is the highest-leverage first surface for an
answer query, since most "what do I know about X?" queries actually
originate from the operator's phone. This task is that first single
follow-up; macOS, mobile, and web adoption are intentionally left for
separate substantive tasks. The naming and shape mirror the prior
Telegram /recall task (`task-add-telegram-recall-command-exposing-the-unified-c.md`,
done 2026-04-27) so the two chat surfaces are operationally consistent.

## Initiative

Personal-assistant answering. KOTA should answer one operator query
with one short composed answer plus typed citations into the second
brain, not just a ranked list of sources. Bringing this experience to
the chat surface — where most personal queries actually originate — is
the first demonstration of the answer seam's value beyond the CLI.

## Acceptance Evidence

- Diff covering the new Telegram `/answer` command registration,
  handler, render path, tests, and module `AGENTS.md` update.
- Unit tests for the rendered output against a synthesized-answer
  fixture spanning at least two source arms, the empty-query /
  `no_hits` / `semantic_unavailable` / `synthesis_failed` branches,
  and the chat-allowlist gate.
- A transcript fixture (or captured chat reply) under the run
  directory showing `/answer <query>` returning a composed answer with
  at least two citations across two source arms (citations resolvable
  against the typed `hits` list in the same response).
