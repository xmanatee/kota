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

- `.kota/runs/<run-id>/metadata.json` for per-workflow run history (read
  through `loadRunsInWindow`, the same seam improver uses).
- `.kota/runs/<run-id>/run-summary.json` for builder commit subjects.
- `data/tasks/blocked/*.md` for aging operator-capture preconditions.
- The in-process `OwnerQuestionQueue` for pending owner questions.
- `data/tasks/<state>/` counts via `countRepoTaskState` for the queue
  delta. The previous snapshot lives in `.kota/daily-digest-state.json`
  and is rewritten at the end of each run.

## Categories Reported

The seven categories named in the source task:

- Builder commits (count, task ids/titles, total duration)
- Explorer additions (per-run task batch and watchlist add counts)
- Decomposer splits (parent → child task count)
- Blocked-promoter moves (blocked → ready/backlog with the move cause)
- Failed/interrupted monitored runs (links operator to attention-digest)
- Pending owner questions and aging operator-capture preconditions
- Queue state delta (current vs previous snapshot)

Per-category surfaces cap at five rows; rendering is intentionally short so
chat surfaces stay readable.

## Relationship To attention-digest

- `attention-digest` reacts to events that need a human (failed runs, stale
  blockers, repeated warnings). Its surface is exception-driven and silent
  when nothing warrants attention.
- `daily-digest` is positive-side complement. It fires on a fixed cadence
  and emits even when the window is quiet so operator silence is never
  ambiguous.
- The two events flow through the same notification module subscriptions
  (Telegram, Slack, email, webhook), so operators do not configure separate
  delivery for them.

## Outputs

Every run writes:

- `digest.json` — the aggregated `DailyDigestData` shape.
- `digest.txt` — the rendered no-color text body.
- An emitted `workflow.daily.digest` event whose `text` field is what
  channel modules forward verbatim. The payload also carries `quiet`
  so channels can label quiet windows distinctly without re-rendering.

## Channel Delivery Contract

`workflow.daily.digest` is included in the default `NOTIFICATION_EVENTS`
list of every shipped notification channel module (`telegram`, `slack`,
`email`, `webhook`). Channel modules treat `payload.text` as the
human-readable body so the workflow code never branches on channel.

## On-Demand Seam

`renderOnDemandDigest({ projectDir, windowEndMs? })` in `on-demand.ts`
produces the same body the cadence step emits, evaluated against a
rolling window ending at the call moment. It is the operator-initiated
counterpart to the 08:00 cadence run; the Telegram `/digest` command,
the terminal `kota digest` command (with `--json` for the structured
`DailyDigestData` payload), the daemon HTTP route `GET /api/digest`
(returning `{ data, text }`), the embedded web client's `DigestPanel`,
the macOS menu-bar client's `DigestView`, and the React Native mobile
client's `DigestScreen` (the latter three consuming that route through
the daemon's typed HTTP+JSON API) all call it directly so every
operator surface reads from the same body.

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
