# Daily Digest Workflow

Cadence-triggered operator-facing rollup of what KOTA accomplished and what
is still pending over a rolling 24h window.

## Cadence

- One cron trigger: `0 8 * * *` (08:00 local). Operators can override the
  schedule per deployment by re-registering the workflow definition; the
  workflow itself is single-purpose.
- The workflow does not subscribe to `runtime.idle` — only the dispatcher
  does (see `workflows/AGENTS.md`).
- Quiet hours: the runtime gates `workflow.daily.digest` the same way it
  gates `workflow.attention.digest`. A digest emitted during quiet hours is
  held and released as a single batched attention digest at window end.

## Data Sources

Read from existing run artifacts, task state, and owner-question state. Do not
add a parallel digest store or second task parser just for this workflow. The
cadence snapshot is the only workflow-owned persistence.

## Categories Reported

Report the operator-relevant daily story: completed work, newly created work,
queue movement, unresolved asks, and failures that need attention. Keep
per-category rendering short so chat surfaces stay readable.

## Relationship To attention-digest

- `attention-digest` reacts to events that need a human (failed runs, stale
  blockers, repeated warnings). Its surface is exception-driven and silent
  when nothing warrants attention.
- `daily-digest` is positive-side complement. It fires on a fixed cadence
  and emits even when the window is quiet so operator silence is never
  ambiguous.
- The two events flow through the same notification module subscriptions
  (Telegram, Slack, email, webhook, push-notification), so operators do not
  configure separate delivery for them. `push-notification` ships an Expo
  push with `data.screen = "digest"` for `workflow.daily.digest` and
  `data.screen = "attention"` for `workflow.attention.digest` so the
  mobile DigestScreen and AttentionScreen wake on the same cadence as
  every other channel.

## Outputs

Every run writes structured data plus the rendered text body, then emits the
rendered text for notification channels to forward without re-rendering.

## Channel Delivery Contract

Channel modules treat the event payload's rendered text as the human-readable
body. The workflow must not branch on channel-specific formatting.

## On-Demand Seam

`renderOnDemandDigest({ projectDir, windowEndMs? })` in `on-demand.ts`
produces the same body the cadence step emits, evaluated against a
rolling window ending at the call moment. Telegram, CLI, slack-channel
(`/digest` slash command via `DigestSnapshotClient`), daemon HTTP
(`GET /api/digest`), embedded web, macOS, and mobile pull surfaces
should consume this seam so cadence and on-demand rendering cannot
drift. The cross-client conformance fixture
`clients/conformance/contract-fixture.json` `digest` arm pins the wire
shape every fan-out client decoder must accept.

Snapshot invariant: the on-demand path does not write
`.kota/daily-digest-state.json`. That file is owned by the cadence run
and must reflect "previous cadence window", not "previous on-demand
call" — otherwise a mid-day `/digest` would corrupt the next 08:00
delta. The cadence and on-demand paths share `computeDigestSnapshot`
so the rendered body cannot drift.

Bus invariant: the on-demand path does not emit `workflow.daily.digest`.
Other notification channels must not see an operator's mid-day `/digest`
as a duplicate cadence digest; the requesting Telegram chat receives
its body in-band.

Agent-feed invariant: like the cadence path, the on-demand body is
operator-facing only and must not be exposed to autonomy agents in any
prompt path (see project memory: no cost bias in autonomy).

## Boundaries

- The digest is operator-facing only. The workflow does not set
  `exposeOutputToAgent` on its step, and no autonomy agent reads
  `digest.json` or the event payload — cost/throughput signals must not
  leak into builder/critic/improver prompts (see project memory: no cost
  bias in autonomy).
- Aggregation is pure: it reads only what is already on disk and the
  in-process owner-question queue. There is no parallel run-summary store.
- Fixtures under `__fixtures__/` document representative active and quiet
  rendered outputs. Tests assert the renderer matches the committed text
  so a renderer change either updates the fixtures or fails CI.
