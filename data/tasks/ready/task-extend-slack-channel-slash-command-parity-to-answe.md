---
id: task-extend-slack-channel-slash-command-parity-to-answe
title: Extend Slack-channel slash-command parity to /answer-log and /answer-show closing the answer-history surface gap
status: ready
priority: p2
area: architecture
summary: Slack-channel slash commands today cover /recall /answer /capture and the just-landed /memory /knowledge /history /tasks /attention /digest set, but they still miss the answer-history reads /answer-log and /answer-show that Telegram already exposes. Extend Slack-channel commands.ts to dispatch both through KotaClient.answer.log and KotaClient.answer.show through the same module-owned renderAnswerHistoryEntriesPlain / renderAnswerReplyPlain renderers Telegram uses, so Slack and Telegram replies match byte-for-byte for the same envelope and Slack DMs reach every answer seam KOTA exposes.
created_at: 2026-04-28T06:46:26.177Z
updated_at: 2026-04-28T06:46:26.177Z
---

## Problem

The just-landed Slack-channel parity task
(`task-extend-slack-channel-slash-command-parity-to-memor`, commit
`8958221d`) extended `src/modules/slack-channel/commands.ts` to dispatch
`/memory`, `/knowledge`, `/history`, `/tasks`, `/attention`, and
`/digest` through the matching `KotaClient` namespaces and the same
module-owned plain-text renderers Telegram uses. The dispatcher now
recognizes nine slash commands total (`/recall`, `/answer`, `/capture`,
plus the four `/capture-to-{memory,knowledge,tasks,inbox}` twins, plus
the six new commands).

Telegram's `src/modules/telegram/status-poll.ts`, however, recognizes
two additional answer-history reads that Slack still lacks:

- `/answer-log [N]` → `KotaClient.answer.log({ limit })` →
  `renderAnswerHistoryEntriesPlain(result.entries)` (newest-first
  envelope of cited-answer history entries).
- `/answer-show <id>` → `KotaClient.answer.show(id)` →
  `renderAnswerReplyPlain(result.record.result)` for the matched
  envelope, or a `not_found` reply when the id misses.

Both renderers already live next to their owning module
(`src/modules/answer/render.ts` exports
`renderAnswerHistoryEntriesPlain` and `renderAnswerReplyPlain`) and are
designed to produce byte-identical reply bodies regardless of which
chat channel emits them. The `KotaClient.answer` namespace already
exposes `log(filter?)` and `show(id)` end-to-end through the daemon
HTTP routes — the web `AnswerHistoryPanel` and Telegram's
`/answer-log` / `/answer-show` paths both consume them today.

The gap is mechanical but visible: an operator who treats Slack DMs as
their primary chat channel can run `/memory` to search a store but
cannot run `/answer-log` to see recent cited-answer envelopes or
`/answer-show <id>` to recall the full body of a specific past answer.
They have to fall back to free-form session prompts that re-route
through the agent loop instead of one-shot daemon calls — exactly the
asymmetry the prior parity task was framed to close.

## Desired Outcome

Slack-channel slash commands recognize `/answer-log` and `/answer-show`
and dispatch each through the same `KotaClient.answer` methods plus
the same plain-text renderers the Telegram channel uses, so a Slack
reply matches the Telegram reply byte-for-byte for the same envelope:

- `handleAnswerLog` in `src/modules/slack-channel/commands.ts` follows
  the shape of the existing `handleRecall` / `handleAnswer` /
  `handleCapture` / new `handleMemory` helpers: parse an optional
  `[N]` limit body (default page size matching Telegram), call
  `clients.answer.log({ limit })`, render with
  `renderAnswerHistoryEntriesPlain`, post the reply.
- `handleAnswerShow` follows the same shape for `/answer-show <id>`:
  surface a usage hint when the body is empty, call
  `clients.answer.show(id)`, render the matched record's `result`
  through `renderAnswerReplyPlain`, post a `not_found`-shaped reply
  when the id misses.
- The dispatcher switch grows two cases (or one shared helper if the
  shapes collapse cleanly).
- `SlackCommandClients` keeps its existing `answer` field — no new
  client wrapper is added; the bot wiring already constructs and
  threads `KotaClient.answer` to the dispatcher, so this task only
  uses the existing field.
- Free-form (non-slash) DMs continue to route to the per-user
  `AgentSession` unchanged. Unknown slash commands still fall through.
- The slash-command tolerance rules already enforced for the existing
  commands (leading whitespace, leading bot-mention prefix, case-
  insensitive head match) cover the two new commands automatically.

## Constraints

- One mechanism. Both new commands must reuse
  `renderAnswerHistoryEntriesPlain` and `renderAnswerReplyPlain` from
  `src/modules/answer/render.ts`; no Slack-specific renderer is
  introduced. If either renderer turns out not to live in the answer
  module, audit Telegram's path before changing scope — the assumption
  is that both renderers Telegram already consumes are exported from
  `src/modules/answer/render.ts`.
- One source of truth. The dispatcher remains the single entry point
  for slash commands. Do not introduce a parallel command registry or
  a per-command file inside `slack-channel/`.
- Reply chunking continues to use the existing `splitText` from
  `client.ts`. `/answer-show` may emit a long body with many citations;
  Telegram's path already chunks the same body, so Slack reuses the
  same `splitText` boundary without a new chunking strategy.
- Errors propagate as thrown exceptions, matching the existing
  recall/answer/capture/memory/knowledge handlers and the Telegram
  bot's one-to-one error surfacing — no Slack-specific error rendering.
- The `not_found` reply shape for `/answer-show <missing-id>` must
  match Telegram's user-facing wording so an operator switching
  channels sees the same message text (compare against
  `src/modules/telegram/status-poll.ts`'s `/answer-show` handler).
- The module-owned config shape (`SlackChannelConfig`) does not grow.
  Neither command requires config beyond what the bot already has.
- `SlackCommandClients` already has the `answer` field used by
  `/answer`; this task reuses it instead of adding a parallel
  `answerHistory` field.
- No backwards-compatibility shim. Delete or refactor any helper
  duplicated between `/answer` and `/answer-log` / `/answer-show` if
  one emerges; do not leave both in place.

## Done When

- `src/modules/slack-channel/commands.ts` recognizes `/answer-log`
  (with optional integer `[N]` body) and `/answer-show <id>`.
- Each command's reply body is rendered by the same module-owned
  plain-text renderer Telegram uses for the same envelope, asserted
  by a focused test that calls the dispatcher and matches the reply
  text against the same renderer's output for the same input.
- Empty-body case for `/answer-show` surfaces the documented
  Telegram-equivalent usage hint (`Usage: /answer-show <id>`).
  Empty-body case for `/answer-log` (no limit argument) is treated
  as the default page size — matching Telegram's no-arg path.
- Missing-id case for `/answer-show <unknown>` produces the same
  user-facing reply text as Telegram's `/answer-show <unknown>` path
  for the same input.
- The bot's command-dispatch test (`src/modules/slack-channel/bot.test.ts`
  or its `commands` test if separate) covers each new command's
  happy-path, empty-body / no-limit, and missing-id behavior, plus
  unknown-command-passthrough.
- A focused parity assertion shows that for one representative
  `/answer-log` envelope and one representative `/answer-show <id>`
  envelope, the Slack reply body is byte-identical to the Telegram
  reply body the existing `status-poll` handler produces for the same
  input.
- Free-form DMs still route to the agent session; the slash-command
  parser still returns `null` for non-slash input.
- `src/modules/slack-channel/AGENTS.md` enumerates `/answer-log` and
  `/answer-show` in its slash-command list, mirroring the entries the
  prior parity task added.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T06-41-54-227Z-explorer-9lnz1o/` immediately
after the just-landed Slack-channel parity task closed the per-store
semantic-search and on-demand attention/digest gap. The same
second-channel-parity framing the owner used in the prior task
(verbatim from that task's Source / Intent: "Operators using Slack
DMs as their primary channel cannot reach the per-store semantic
search or the on-demand attention/digest seams without falling back
to free-form session prompts that re-route through the agent loop
instead of one-shot daemon calls") applies one-to-one to
`/answer-log` and `/answer-show`: both expose answer-history reads
that Telegram already serves and Slack DMs cannot reach without
falling back to the agent loop.

The web client closed its share of the answer-history fan-out via
`task-add-web-answerhistorypanel-consuming-the-answer-hi`
(`AnswerHistoryPanel.tsx` + tests) and the integration test
`task-add-recall-plus-cited-answer-plus-answer-history-e` anchored
the recall+answer+answer-history pipeline end-to-end. Slack-channel
is the remaining chat-channel surface; the macOS and mobile native
clients are tracked separately under the broader native-client
fan-out (no AnswerHistoryView / AnswerHistoryScreen exists today).
This task closes the Slack-DM half of the answer-history surface
gap.

## Initiative

Second-channel parity for the operator chat surface: Slack-channel
slash commands match Telegram's slash-command surface for every seam
KOTA already exposes through `KotaClient`, so an operator can switch
between Telegram and Slack DMs without losing access to any one-shot
read or capture path. After this task lands, every Telegram slash
command in `status-poll.ts` has a matching Slack-channel dispatcher
case, and the chat-channel parity contract is complete.

## Acceptance Evidence

- Diff extending `src/modules/slack-channel/commands.ts`, the
  bot's command-dispatch tests, and the slack-channel `AGENTS.md`
  command enumeration.
- A focused dispatcher test transcript showing each new command's
  reply body matches the same module-owned renderer's output for the
  same envelope (one happy-path per command, plus `/answer-show
  <unknown>`-shaped not-found and `/answer-log` no-arg default-limit
  cases).
- A short snippet (or test) showing that for one representative
  `/answer-log` and one representative `/answer-show <id>` envelope,
  the Slack reply body is byte-identical to the Telegram reply body
  produced by `status-poll`'s handler for the same input.
