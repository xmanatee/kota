---
id: task-add-a-telegram-digest-command-that-emits-the-lates
title: Add a Telegram /digest command that emits the latest daily-digest on demand
status: ready
priority: p2
area: modules
summary: Mirror the existing Telegram /status command with /digest, which runs the daily-digest aggregator+renderer on demand and posts the rendered text to the chat without disturbing the 24h cadence snapshot.
created_at: 2026-04-26T02:47:21.729Z
updated_at: 2026-04-26T02:47:21.729Z
---

## Problem

The `daily-digest` workflow that just shipped fires once per day on a fixed
cron (`0 8 * * *` local). When the operator wants to know mid-day "what has
KOTA done so far today", there is no way to fetch the rollup on demand. The
Telegram channel module already supports `/status` as a polling-driven
operator command, but there is no equivalent on-demand entry point for the
digest. The operator has to either wait for the next cadence fire, scrape
`.kota/runs/`, or read git log.

The daily-digest workflow has cleanly separated aggregation
(`aggregate.ts`) from rendering (`render.ts`) and from the cron-driven
workflow shell (`workflow.ts`). The aggregator reads only `.kota/runs/`,
the task tree, and the in-process owner-question queue. So the on-demand
path can reuse the same aggregator and renderer without re-running the
full workflow shell — and crucially without rewriting
`.kota/daily-digest-state.json` (the queue-delta snapshot used by the
cadence workflow), so the on-demand call does not corrupt the next
cadence's "delta vs previous window" baseline.

## Desired Outcome

Sending `/digest` to the Telegram chat that currently receives `/status`
returns the same rendered digest body that the next 08:00 cadence run
would produce, evaluated against the rolling 24h window ending at the
moment of the request. The Telegram message body is identical in shape to
the cadence-emitted digest so operators do not need to learn two formats.
The on-demand call does not alter the cadence's queue-delta snapshot, and
does not emit a `workflow.daily.digest` event (otherwise notification
channels other than the requesting Telegram chat would receive a
duplicate, surprising digest).

## Constraints

- Reuse `aggregate.ts` and `render.ts` from
  `src/modules/autonomy/workflows/daily-digest/`. Do not duplicate the
  aggregation logic in the telegram module.
- The shared seam should be a thin function (e.g. `renderOnDemandDigest`)
  exposed from the daily-digest module, not a workflow trigger. Telegram
  calls this function directly through a daemon-control route or a new
  KotaClient method, consistent with how operator CLIs reach into module
  state.
- Do not write `.kota/daily-digest-state.json` from the on-demand path —
  that snapshot is owned by the cadence run and must reflect "previous
  cadence window", not "previous on-demand call".
- Do not emit `workflow.daily.digest` from the on-demand path. The
  Telegram channel responds in-band to the requesting chat only.
- The on-demand digest is operator-facing only, like the cadence digest.
  Per the autonomy-mode no-cost-bias contract, the rendered text must
  not be exposed to autonomy agents in any prompt path.
- The `/digest` command obeys the same chat allowlist (`TELEGRAM_ALERT_CHAT_ID`)
  as `/status`. Disallowed chats receive no response.
- Quiet-hours behavior diverges intentionally from the cadence: the
  on-demand call is operator-initiated, so it should reply immediately
  regardless of quiet hours (operator silence is the cadence concern, not
  on-demand).
- The Telegram bot's existing polling loop already handles `/status`; add
  `/digest` to the same dispatch path. Do not introduce a parallel
  long-poll loop.

## Done When

- `src/modules/autonomy/workflows/daily-digest/` exposes a pure function
  that produces the rendered digest text and underlying data given the
  current `.kota/runs/`, task tree, and owner-question queue, without
  writing the cadence snapshot file. The cadence workflow uses the same
  function so the two paths cannot drift.
- The Telegram status-poll handler responds to `/digest` from the
  allowlisted chat by calling that function and posting the rendered text
  back to the chat.
- A focused unit test in the telegram module asserts that a `/digest`
  inbound update produces a Telegram `sendMessage` with the rendered
  text body, using a fixture run window mirroring an existing
  daily-digest fixture.
- A focused unit test in the daily-digest module asserts that the
  on-demand entry point does not write `.kota/daily-digest-state.json`
  and does not emit `workflow.daily.digest`, distinguishing it from the
  cadence path.
- Local `AGENTS.md` files for both `src/modules/telegram/` and
  `src/modules/autonomy/workflows/daily-digest/` describe the
  on-demand seam at the conventions level (purpose, snapshot
  invariant, agent-feed exclusion).

## Source / Intent

The `daily-digest` workflow shipped 2026-04-26 (commit 48d7eeea) closes
the operator-visibility gap for "what did KOTA do last night", but the
cadence is fixed at 08:00. The owner-facing pattern from recent work
(KotaClient namespace migration, operator-CLI refactor cluster, daily
digest itself) is "any operator question that gets asked through chat or
CLI should have a path that is not 'wait for cron'". `/status` is the
existing precedent; `/digest` is the symmetric extension. This continues
the larger product-grade-operator-UX initiative the owner has been
explicitly pushing on (see the rich-CLI-rendering blocked task and the
2026-04-25 inbox reinforcement that the owner perceives operator output
as still poor).

## Initiative

Operator observability for autonomous KOTA operation: every
operator-facing surface (CLI, Telegram, future channels) should answer
"what's the system doing right now" and "what did it accomplish" without
the operator scraping `.kota/runs/`. `/digest` is the on-demand
counterpart to the 08:00 cadence digest.

## Acceptance Evidence

- A live-run artifact under `.kota/runs/<run-id>/` capturing a Telegram
  `/digest` exchange against a real or replayed run window: the inbound
  message, the bot's response payload, and a side-by-side check that
  the on-demand body matches what the cadence run produced for the same
  window.
- Co-located unit tests in `src/modules/telegram/` and
  `src/modules/autonomy/workflows/daily-digest/` exercise both the
  command-dispatch path and the no-snapshot-write / no-bus-event
  invariants, and pass on `pnpm test`.
- Confirmation that `.kota/daily-digest-state.json` is unchanged after
  an on-demand call (recorded in the run artifact).
