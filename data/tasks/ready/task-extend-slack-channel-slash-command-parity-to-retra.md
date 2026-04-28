---
id: task-extend-slack-channel-slash-command-parity-to-retra
title: Extend Slack-channel slash-command parity to /retract-<store> closing the chat-channel parity gap
status: ready
priority: p2
area: architecture
summary: Slack-channel commands.ts dispatches /recall /answer /answer-log /answer-show /capture (plus the /capture-to-{memory,knowledge,tasks,inbox} twins) and the per-store /memory /knowledge /history /tasks /attention /digest reads, but it does not yet recognize the four /retract-{memory,knowledge,tasks,inbox} commands Telegram exposes via status-poll.ts after the cross-store retract seam shipped. Extend Slack-channel commands.ts to dispatch each /retract-<store> through KotaClient.retract.retract using the same module-owned renderRetractResultPlain renderer Telegram uses, so Slack and Telegram replies match byte-for-byte for every retract envelope.
created_at: 2026-04-28T14:09:42.133Z
updated_at: 2026-04-28T14:09:42.133Z
---

## Problem

The cross-store retract seam (`task-add-a-unified-cross-store-retract-seam-mirroring-c`,
commit `546cacab`) is now reachable from the CLI (`kota retract`), the
daemon control server (`POST /retract` and `POST /api/retract`), Telegram
(`/retract-<store>` commands, commit `9ba14254`), the web client
(`RetractPanel`, commit `e24bf8e3`), the macOS menu-bar contract layer
and view (commits `600b553f` and `2ce50f6a`), and the mobile screen plus
its `DaemonClient.retract` (commit `8b9d29d8`).

The Slack-channel slash-command surface, however, still does not
recognize the four `/retract-{memory,knowledge,tasks,inbox}` commands.
The just-landed parity sweep
(`task-extend-slack-channel-slash-command-parity-to-answe`, commit
`819792e9`) framed the contract as "every Telegram slash command in
`status-poll.ts` has a matching Slack-channel dispatcher case" — but that
sweep landed before the retract seam, and Telegram's
`src/modules/telegram/status-poll.ts` has since grown four more handlers
(`handleRetractCommand`, lines ~423-451) and a `RetractClient` field on
its dispatch type.

`src/modules/slack-channel/commands.ts` currently grep'es zero hits for
`retract` or `RetractClient`; its `SlackCommandClients` type carries
`recall`, `answer`, `capture`, `memory`, `knowledge`, `history`, `tasks`,
`attention`, and `digest` clients but no `retract` client. Its module
`AGENTS.md` first-class slash-command list (lines 7-14) does not name
the four retract commands.

The asymmetry is exactly the one the prior parity tasks were framed to
close: an operator who treats Slack DMs as their primary chat channel
can capture into any store and recall/answer against any store, but
cannot reach the retract seam without falling back to free-form session
prompts that re-route through the agent loop instead of one-shot daemon
calls. The retract seam is the symmetric correction-side surface for
capture, and the chat-channel-parity contract requires it.

## Desired Outcome

Slack-channel slash commands recognize `/retract-memory`,
`/retract-knowledge`, `/retract-tasks`, and `/retract-inbox`, dispatching
each through `KotaClient.retract.retract` with the same module-owned
plain-text renderer (`renderRetractResultPlain` from
`src/modules/retract/render.ts`) Telegram uses, so a Slack reply matches
the Telegram reply byte-for-byte for the same `RetractResult` envelope:

- One shared `handleRetract` helper in
  `src/modules/slack-channel/commands.ts` (mirroring Telegram's
  `handleRetractCommand` shape) takes the lowercased command head, the
  trimmed argument body, and a `SlackCommandClients` reference; it
  surfaces the per-target usage hint when the body is empty / whitespace,
  builds the typed per-target `RetractRequest` arm (`{target:"memory",
  id}` / `{target:"knowledge", slug}` / `{target:"tasks", id}` /
  `{target:"inbox", path}`), calls `clients.retract.retract(request)`,
  renders the result through `renderRetractResultPlain`, and posts the
  reply.
- The dispatcher switch grows four cases (or one collapsed branch over
  a `RETRACT_COMMAND_TARGET` lookup parallel to the existing
  `CAPTURE_TO_COMMAND` lookup at `commands.ts:83-88`).
- `SlackCommandClients` grows a `retract: RetractClient` field; the bot
  wiring in `src/modules/slack-channel/bot.ts` constructs and threads
  the existing `KotaClient.retract` namespace to the dispatcher
  alongside the existing fields.
- The empty-body usage hints match Telegram's wording verbatim — see
  `src/modules/telegram/status-poll.ts:51-63`'s `retractUsageBody`.
  Reuse the same per-command hint table; if the duplication grows,
  factor it into the `retract` module's render helper rather than
  inventing a Slack-only table.
- Free-form (non-slash) DMs continue to route to the per-user
  `AgentSession` unchanged. Unknown slash commands still fall through.
- The slash-command tolerance rules already enforced for the existing
  commands (leading whitespace, leading bot-mention prefix, case-
  insensitive head match) cover the four new commands automatically.
- `src/modules/slack-channel/AGENTS.md` enumerates the four
  `/retract-<store>` commands in its slash-command list, mirroring the
  entries the prior parity tasks added.

## Constraints

- One mechanism. Both new and existing commands must reuse
  `renderRetractResultPlain` from `src/modules/retract/render.ts`; no
  Slack-specific renderer is introduced. The umbrella `/retract` help
  body Telegram exposes (`src/modules/telegram/status-poll.ts:40-49`)
  is out of scope here — Slack only adopts the four target-specific
  commands the operator actually invokes; if a future task wants the
  umbrella `/retract` help in Slack, it can add it as a follow-up.
- One source of truth. The dispatcher remains the single entry point
  for slash commands. Do not introduce a parallel command registry, a
  per-command file inside `slack-channel/`, or a second per-target
  branch outside the existing `commands.ts` switch.
- Reply chunking continues to use the existing `splitText` from
  `client.ts`. `RetractResult` bodies are short by construction (the
  `success` arms are one record line, `not_found` and
  `contributor_failed` are one notice line), but `splitText` still
  governs all replies for consistency.
- Errors propagate as thrown exceptions, matching the existing
  recall/answer/capture/memory/knowledge handlers and the Telegram
  bot's one-to-one error surfacing — no Slack-specific error rendering
  for the three `ok: false` arms (`no_contributors`, `not_found`,
  `contributor_failed`); each is rendered through the same
  `renderRetractResultPlain` branch.
- The empty-body `Usage: /retract-<target> <identifier-name>` reply
  text must match Telegram's user-facing wording so an operator
  switching channels sees the same message text. Compare against
  `src/modules/telegram/status-poll.ts:51-63`'s `retractUsageBody`.
- The module-owned config shape (`SlackChannelConfig`) does not grow.
  None of the four new commands requires config beyond what the bot
  already has — the `retract` namespace is on the existing
  `KotaClient`.
- `SlackCommandClients` grows exactly one field (`retract:
  RetractClient`); do not split it across four per-target fields when
  one client covers all four arms.
- No backwards-compatibility shim. If the empty-body usage helper
  duplicates code between the four cases or between Slack and Telegram,
  fold it through a shared module-owned helper; do not leave two
  parallel helpers in place.
- Approval-queue interactions (`bot.ts`'s Block Kit Approve/Reject
  buttons) are out of scope — retract is a one-shot daemon call from
  the operator, not an autonomous-agent dangerous tool call gated
  through the approval queue from the Slack surface.

## Done When

- `src/modules/slack-channel/commands.ts` recognizes `/retract-memory
  <id>`, `/retract-knowledge <slug>`, `/retract-tasks <id>`, and
  `/retract-inbox <path>`.
- `SlackCommandClients` exposes a `retract: RetractClient` field;
  `src/modules/slack-channel/bot.ts` constructs the dispatcher with
  `clients.retract.retract` already wired through `KotaClient.retract`.
- Each command's reply body is rendered by
  `renderRetractResultPlain` from `src/modules/retract/render.ts`,
  asserted by a focused test that calls the dispatcher and matches the
  reply text against the same renderer's output for the same input.
- Empty-body case for each command surfaces the Telegram-equivalent
  usage hint (`Usage: /retract-memory <id>`,
  `Usage: /retract-knowledge <slug>`, `Usage: /retract-tasks <id>`,
  `Usage: /retract-inbox <path>`).
- Missing-record case for each command (e.g. `/retract-memory
  <unknown-id>`) renders the seam's `not_found` arm verbatim through
  the shared renderer, matching Telegram's reply for the same input.
- `no_contributors` and `contributor_failed` arms render through the
  same renderer without throwing; they reach the operator as one-shot
  reply text, not as Slack-specific error messages.
- The bot's command-dispatch test
  (`src/modules/slack-channel/bot.test.ts` or its `commands` test if
  separate) covers each new command's happy-path success arm,
  empty-body usage hint, missing-id `not_found` arm, and unknown-
  command-passthrough.
- A focused parity assertion shows that for one representative
  per-target `RetractResult` envelope (one `success` + one `not_found`
  is enough), the Slack reply body is byte-identical to the Telegram
  reply body produced by `status-poll`'s `handleRetractCommand` for the
  same input.
- Free-form DMs still route to the agent session; the slash-command
  parser still returns `null` for non-slash input.
- `src/modules/slack-channel/AGENTS.md` enumerates `/retract-memory`,
  `/retract-knowledge`, `/retract-tasks`, and `/retract-inbox` in its
  slash-command list, mirroring the entries the prior parity tasks
  added.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T14-06-46-827Z-explorer-lpdj9a/` immediately
after the cross-store retract fan-out closed its final operator
surface (`task-add-mobile-retractscreen-consuming-a-new-daemoncli`,
commit `8b9d29d8`). The retract seam task explicitly named Slack
parity as the sibling follow-up that extends the existing
`task-extend-slack-channel-slash-command-parity-to-*` cluster
(verbatim from the seam task's `## Constraints`: "Slack `/retract` is
a sibling follow-up that extends the existing
`task-extend-slack-channel-slash-command-parity-to-*` cluster and
stays out of scope here").

The just-landed parity sweep
(`task-extend-slack-channel-slash-command-parity-to-answe`, commit
`819792e9`) closed the answer-history half of the chat-channel parity
contract and framed the contract as "every Telegram slash command in
`status-poll.ts` has a matching Slack-channel dispatcher case". With
retract now shipped on Telegram (`9ba14254`) and zero Slack hits for
`retract` in `commands.ts`, the contract has reopened a four-handler
gap that this task closes.

The same operator framing the prior parity tasks used applies
one-to-one to retract: an operator using Slack DMs as their primary
channel cannot reach the symmetric correction-side surface for the
already-shipped capture/recall/answer chain without falling back to
free-form session prompts that re-route through the agent loop instead
of one-shot daemon calls.

## Initiative

Second-channel parity for the operator chat surface: Slack-channel
slash commands match Telegram's slash-command surface for every seam
KOTA already exposes through `KotaClient`, so an operator can switch
between Telegram and Slack DMs without losing access to any one-shot
read, capture, or correction path. After this task lands, every
Telegram slash command in `status-poll.ts` (including the four
`/retract-<store>` handlers) has a matching Slack-channel dispatcher
case, and the chat-channel parity contract closes again.

## Acceptance Evidence

- Diff extending `src/modules/slack-channel/commands.ts`
  (`SlackCommandClients` gains `retract`, the dispatcher recognizes
  the four `/retract-<store>` commands, the shared `handleRetract`
  helper plus per-target arm builder), the bot wiring in
  `src/modules/slack-channel/bot.ts` (threads `clients.retract`
  through), the bot's command-dispatch tests, and the slack-channel
  `AGENTS.md` command enumeration.
- A focused dispatcher test transcript showing each new command's
  reply body matches `renderRetractResultPlain`'s output for the same
  envelope (one happy-path `success` per target, plus one
  empty-body usage-hint case and one missing-id `not_found` case).
- A short snippet (or test) showing that for one representative
  per-target `RetractResult` envelope (one `success` + one
  `not_found`), the Slack reply body is byte-identical to the Telegram
  reply body produced by `status-poll`'s `handleRetractCommand` for
  the same input, captured under `.kota/runs/<run-id>/`.
- Test output showing the new test cases passing alongside the
  existing slack-channel test suite, with `pnpm typecheck`,
  `pnpm lint`, and `pnpm test` green.
