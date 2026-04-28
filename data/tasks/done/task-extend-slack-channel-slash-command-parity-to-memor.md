---
id: task-extend-slack-channel-slash-command-parity-to-memor
title: Extend Slack-channel slash-command parity to /memory /knowledge /history /tasks /attention and /digest matching the Telegram surface
status: done
priority: p2
area: architecture
summary: Slack-channel slash commands today only cover the cross-store recall/answer/capture seams. Telegram already exposes the per-store semantic-search seams /memory /knowledge /history /tasks plus on-demand /attention and /digest, all consuming KotaClient namespaces and the module-owned plain-text renderers. Extend Slack-channel commands.ts to dispatch the same six commands through the same renderers so a Slack reply matches Telegram byte-for-byte for the same envelope, closing the second-channel parity gap left after the capture fan-out.
created_at: 2026-04-28T06:10:18.938Z
updated_at: 2026-04-28T06:35:11.657Z
---

## Problem

Slack-channel slash commands in `src/modules/slack-channel/commands.ts`
today recognize only `/recall`, `/answer`, `/capture`, and the four
`/capture-to-{memory,knowledge,tasks,inbox}` twins. Every other slash
command falls through to the per-user agent session.

The Telegram channel (`src/modules/telegram/status-poll.ts`) recognizes
six additional slash commands that all reduce to one-shot daemon calls
plus a module-owned plain-text renderer:

- `/memory <query>` → `KotaClient.memory.search` → `renderMemoryHitsPlain`
- `/knowledge <query>` → `KotaClient.knowledge.search` → `renderKnowledgeHitsPlain`
- `/history <query>` → `KotaClient.history.search` → `renderHistoryHitsPlain`
- `/tasks <query>` → `KotaClient.tasks.search` → `renderTasksReplyPlain`
- `/attention` → `KotaClient.attention.snapshot` → renderer
- `/digest` → `KotaClient.digest.snapshot` → renderer

These renderers already live next to their owning module
(`src/modules/{memory,knowledge,history,repo-tasks,...}/render.ts`) and
are designed to produce byte-identical reply bodies regardless of which
chat channel emits them. Slack-channel commands that consume the same
`KotaClient` namespaces would match the established pattern of
`handleRecall` / `handleAnswer` / `handleCapture` exactly, with no new
seam, no new renderer, and no Slack-only formatting.

The result of leaving this gap open is that the second-channel-parity
contract is uneven: Telegram is a complete operator surface, Slack is
half-built. Operators using Slack DMs as their primary channel cannot
reach the per-store semantic search or the on-demand attention/digest
seams without falling back to free-form session prompts that re-route
through the agent loop instead of one-shot daemon calls.

## Desired Outcome

Slack-channel slash commands recognize the same six commands as Telegram
and dispatch each through the same `KotaClient` namespace plus the same
plain-text renderer the Telegram channel uses, so a Slack reply matches
the Telegram reply byte-for-byte for the same envelope:

- One `handleX` per new command in `commands.ts`, each following the
  shape of the existing `handleRecall` / `handleAnswer` / `handleCapture`
  helpers (usage hint when body empty, daemon call, plain-text renderer).
- The dispatcher switch grows the six new cases plus any natural shared
  helper if multiple commands collapse to the same shape.
- `SlackCommandClients` grows the four namespace fields the new
  commands need (`memory`, `knowledge`, `history`, `tasks` for the
  semantic-search commands; `attention` and `digest` for the on-demand
  commands), with the bot wiring updated to pass them through.
- Free-form (non-slash) DMs continue to route to the per-user
  `AgentSession` unchanged. Unknown slash commands still fall through.
- The slash-command tolerance rules already enforced for the existing
  three commands (leading whitespace, leading bot-mention prefix,
  case-insensitive head match) cover the six new commands automatically;
  no parser branch grows beyond extending the dispatcher.

## Constraints

- One mechanism. Every new command must reuse an existing module-owned
  renderer; no Slack-specific renderer is introduced. If a renderer is
  missing for a command Telegram already exposes, audit whether
  Telegram's path is actually using a module-owned renderer or a Slack-
  unique helper before blocking on this task — the assumption is that
  every renderer Telegram consumes already lives in the module's
  `render.ts` and is exported.
- One source of truth. The dispatcher remains the single entry point
  for slash commands. Do not introduce a parallel command registry or
  a per-command file inside `slack-channel/`.
- Reply chunking continues to use the existing `splitText` from
  `client.ts`. No new chunking strategy is introduced.
- Errors propagate as thrown exceptions, matching the existing
  recall/answer/capture handlers and the Telegram bot's one-to-one
  error surfacing — no Slack-specific error rendering.
- The module-owned config shape (`SlackChannelConfig`) only grows if a
  new command genuinely needs config. None of the six commands today
  require config beyond what the bot already has.
- `SlackCommandClients` becomes the single place the bot threads
  `KotaClient` namespaces into the dispatcher. No second client wrapper
  is added.

## Done When

- `src/modules/slack-channel/commands.ts` recognizes `/memory`,
  `/knowledge`, `/history`, `/tasks`, `/attention`, and `/digest`.
- Each command's reply body is rendered by the same module-owned
  plain-text renderer Telegram uses for the same envelope, asserted by
  a focused test that calls the dispatcher and matches the reply text
  against the same renderer's output for the same input.
- Empty-body cases for the four query commands surface the documented
  Telegram-equivalent usage hint (e.g. `Usage: /memory <query>`).
- `/attention` and `/attention <noise>` both succeed (Telegram ignores
  the body for these on-demand commands; Slack should match).
- The bot's command-dispatch test (`src/modules/slack-channel/bot.test.ts`
  or its `commands` test if separate) covers each new command's
  happy-path, empty-body, and unknown-command-passthrough behavior.
- Free-form DMs still route to the agent session; the slash-command
  parser still returns `null` for non-slash input.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T06-05-59-251Z-explorer-y8kwfp/` after the recent
capture fan-out cluster ended with five operator surfaces (Telegram,
web, macOS, mobile, Slack) consuming the cross-store seams but Slack
still missing the per-store semantic-search seams and the on-demand
attention/digest seams that Telegram already exposes. The owner's
recurring "Telegram and Slack are both first-class operator chat
channels" framing implies Slack should not stay half-built relative to
Telegram once the cross-store seams stabilize.

## Initiative

Second-channel parity for the operator chat surface: Slack-channel
slash commands match Telegram's slash-command surface for every seam
KOTA already exposes through `KotaClient`, so an operator can switch
between Telegram and Slack DMs without losing access to any one-shot
read or capture path.

## Acceptance Evidence

- Diff extending `src/modules/slack-channel/commands.ts`,
  `SlackCommandClients`, and the bot wiring that constructs it.
- A focused dispatcher test transcript showing each new command's
  reply body matches the same module-owned renderer's output for the
  same envelope.
- A short snippet (or test) showing that switching the same input
  between the existing Telegram path and the new Slack path produces
  byte-identical reply text for at least one representative command.
