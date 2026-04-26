---
id: task-add-telegram-attention-command-exposing-on-demand-
title: Add Telegram /attention command exposing on-demand attention digest
status: done
priority: p2
area: modules
summary: Add a Telegram /attention command that runs the attention-digest detector on demand and posts the rendered attention items to the chat, mirroring the /digest precedent and giving operators a pull-side counterpart to the cadence-driven attention push.
created_at: 2026-04-26T06:49:49.338Z
updated_at: 2026-04-26T06:56:23.671Z
---

## Problem

The `attention-digest` workflow (`src/modules/autonomy/workflows/
attention-digest/`) is purely reactive: `runAttentionDigestStep` runs
every 10 builder cycles, evaluates attention items (failure streaks,
repeated warnings, stalled work, blocked backlog, empty queues,
operator-gated aging), and emits `workflow.attention.digest` only when
something warrants attention. Telegram, Slack, email, and webhook
channels forward that push as `payload.text`.

Outside the cadence, operators have no way to ask "is there anything
needing attention right now?". They must wait for the next reactive
trigger or scrape `.kota/runs/`, the task tree, and the run summary
counter. The recently-shipped `daily-digest` initiative
(commit `68451bf5` and downstream surfaces through commit `7660227f`)
established a clean operator-pull pattern for the symmetric "rolling
window" digest: a pure `renderOnDemandDigest({ projectDir })` seam in
the workflow module, surfaced as Telegram `/digest`, `kota digest`,
`/api/digest`, and the web/macOS/mobile clients. The same pattern is
not yet available for attention items, leaving `attention-digest` as
the only operator-facing autonomy surface that cannot be pulled.

The attention-digest step currently mixes counter persistence, trigger
gating, item detection, and rendering inside `runAttentionDigestStep`.
The detection (`detectAttentionItems`) and rendering (`buildDigestText`)
already read only repo state (`.kota/runs/`, `data/tasks/<state>/`,
the in-process owner-question-aware blocked precondition parser), so a
pure on-demand seam can reuse them without re-running the cadence
counter or duplicating logic.

## Desired Outcome

Sending `/attention` to the Telegram chat that already receives
`/status` and `/digest` returns the current attention items rendered
in the same format the next cadence push would produce, evaluated
against the live repo state at request time. When no items warrant
attention the bot replies with a short, explicit "no attention items"
body so the operator can distinguish "nothing wrong" from "command
failed". The on-demand call does not advance the cadence counter, does
not emit `workflow.attention.digest` on the bus, and is not visible to
any autonomy agent prompt.

## Constraints

- Refactor `attention-digest/step.ts` so item detection and rendering
  are exposed through a pure `renderOnDemandAttention({ projectDir,
  runsDir })` seam returning `{ items: AttentionItem[]; text: string }`.
  The cadence step (`runAttentionDigestStep`) calls the same seam so
  the two paths cannot drift.
- Do not write the attention-digest counter
  (`<runsDir>/../attention-digest-counter.json`) from the on-demand
  path. That file is owned by the cadence step and must reflect
  "cycles since the last cadence-driven evaluation".
- Do not emit `workflow.attention.digest` from the on-demand path.
  Other notification channels (Slack, email, webhook) must not see an
  operator's mid-cycle `/attention` as a duplicate cadence digest; the
  requesting Telegram chat receives the rendered text in-band.
- Quiet hours do not gate the on-demand path. The operator initiated
  the request, so the runtime quiet-hours rule that buffers cadence
  pushes does not apply.
- The on-demand body is operator-facing only and must not be exposed
  to autonomy agents in any prompt path. Mirror the existing
  agent-feed invariant in the `daily-digest` AGENTS.md.
- The `/attention` command obeys the same chat allowlist
  (`TELEGRAM_ALERT_CHAT_ID`) as `/status` and `/digest`. Disallowed
  chats receive no response.
- Telegram dispatch piggy-backs on the existing `status-poll.ts`
  command path; do not introduce a parallel polling loop.
- When `detectAttentionItems` returns no items, the on-demand path
  produces a short fixed reply (e.g. "No attention items right now.")
  rather than the cadence-style header with an empty bullet list.
- Render parity check: when items exist, the on-demand body matches
  what the cadence run would emit for the same `(projectDir, runsDir)`
  state, character-for-character through `buildDigestText`.

## Done When

- `src/modules/autonomy/workflows/attention-digest/` exposes a pure
  `renderOnDemandAttention` function whose return shape is the
  attention-items array plus the rendered text body. The cadence step
  uses the same function so the two paths cannot drift.
- Telegram `status-poll.ts` dispatches `/attention` (alongside
  `/status` and `/digest`) by calling that function and posting the
  rendered text to the chat; disallowed chats are ignored.
- Co-located unit tests assert: (a) the on-demand path does not write
  the attention-digest counter, (b) the on-demand path does not emit
  `workflow.attention.digest`, (c) the on-demand body matches the
  cadence path's body for a fixture state with items, (d) the no-items
  branch produces the short fixed reply.
- A focused unit test in the telegram module asserts that an inbound
  `/attention` update from the allowlisted chat invokes
  `sendMessage` with the rendered attention text, mirroring the
  existing `/digest` test.
- Local `AGENTS.md` for both `src/modules/telegram/` and
  `src/modules/autonomy/workflows/attention-digest/` describe the
  on-demand seam at the conventions level (purpose, counter and
  bus-event invariants, agent-feed exclusion). The `daily-digest`
  AGENTS.md is updated only if its operator-pull paragraph needs to
  cross-reference attention parity.

## Source / Intent

The `daily-digest` operator-pull initiative just landed across seven
surfaces (Telegram `/digest` 68451bf5, `kota digest` ac5ba758,
`GET /api/digest` bbe6c50c, web `DigestPanel` 7d423e76, macOS
`DigestView` 19552628, mobile `DigestScreen` 7cbb403a, push
notifications 7660227f). The owner-facing pattern from that
initiative is "every operator-facing autonomy surface should be
pull-able, not just push-driven". `attention-digest` is the only
remaining operator-facing autonomy workflow without an on-demand
counterpart. The Telegram surface is the historical first surface
across this initiative (`/digest` shipped before any other client
consumed the seam), so seeding the on-demand seam plus Telegram
parity continues that proven pattern. Subsequent surfaces (`kota
attention`, `/api/attention`, web/macOS/mobile attention panels) can
follow as their own follow-up tasks once the seam is in place.

## Initiative

Operator observability for autonomous KOTA operation: every
operator-facing surface should answer "what's the system doing right
now" and "what currently warrants attention" without the operator
scraping `.kota/runs/`. `/attention` is the on-demand counterpart to
the every-N-runs cadence attention push, completing pull-surface
parity between `daily-digest` and `attention-digest`.

## Acceptance Evidence

- A live-run artifact under `.kota/runs/<run-id>/` capturing a
  Telegram `/attention` exchange against a real or replayed runs/tasks
  state: the inbound message, the bot's response payload, and a
  side-by-side check that the on-demand body matches what the cadence
  step would produce for the same state.
- Co-located unit tests in `src/modules/telegram/` and
  `src/modules/autonomy/workflows/attention-digest/` exercise both the
  command-dispatch path and the no-counter-write / no-bus-event
  invariants, and pass on `pnpm test`.
- Confirmation that `<runsDir>/../attention-digest-counter.json` is
  unchanged after an on-demand call (recorded in the run artifact).
