---
id: task-add-an-autonomy-daily-digest-workflow-surfacing-wh
title: Add an autonomy daily digest workflow surfacing what KOTA accomplished over a rolling window
status: done
priority: p2
area: autonomy
summary: Add a periodic autonomy workflow that emits an operator-facing digest of completed/failed work (builder commits, explorer additions, decomposer splits, blocked-promoter moves, pending owner questions) over a rolling window so operators can see autonomy progress without scraping .kota/runs/.
created_at: 2026-04-26T00:59:10.368Z
updated_at: 2026-04-26T01:20:24.255Z
---

## Problem

The existing `attention-digest` workflow is reactive — it fires on
`workflow.build.committed`, on failed/interrupted monitored runs, and on
`runtime.recovered`. It tells the operator about the latest event, not about
the broader rhythm of what KOTA did over the last 24 hours. There is no
periodic "what got accomplished" surface. To answer "what did autonomy do
last night?" the operator has to scrape `.kota/runs/`, `git log`, and the
task tree by hand. That makes long-running autonomous operation
operator-hostile and hides whether the loop is actually producing value or
just churning.

The `improver` workflow already aggregates run outcomes via
`loadRecentRuns()` / `computeCostByWorkflow()` for its own self-improvement
prompt. The same aggregation seam can power an operator-facing digest, but
no workflow today emits one on a fixed cadence.

## Desired Outcome

A single autonomy workflow runs on a rolling cadence (e.g. once every 24h
via the existing scheduler module) and emits one operator-facing digest
that summarizes:

- Builder commits landed (count, task ids/titles, total duration)
- Explorer additions (new tasks created, watchlist updates)
- Decomposer splits (parent → children)
- Blocked-promoter moves (blocked → ready/backlog with the unblock reason)
- Failed or interrupted monitored runs (count + names, with a link to the
  attention-digest stream for full detail)
- Pending owner questions and aging operator-capture preconditions
- Queue state delta vs. start of window (counts.ready, counts.blocked, etc.)

The digest is delivered through the existing `notification` module so the
configured Telegram / Slack / push channels receive it; operators do not
read it by tailing `.kota/runs/`.

## Constraints

- Reuse the existing run-outcome aggregation in
  `src/modules/autonomy/shared.ts` and the `notification` module's typed
  bus events. Do not introduce a parallel run-summary store or a second
  notification path.
- Do not feed the digest content back into autonomy agents' context. The
  digest is operator-facing only; cost/throughput signals must not leak
  into builder/critic/improver prompts (see project memory: no cost bias
  in autonomy).
- The workflow must declare its trigger explicitly. Use the scheduler
  module's cron or a recurring trigger; do not subscribe to
  `runtime.idle` (per `workflows/AGENTS.md` — only the dispatcher does).
- The digest body should be deterministic and rendered through the
  `rendering` module's primitives so the Telegram / Slack / push payload
  shape stays consistent across surfaces.
- If the window had zero activity, the workflow should still emit a
  short "no activity" message rather than going silent — operator
  silence is ambiguous.
- Keep the workflow declaration co-located under
  `src/modules/autonomy/workflows/<name>/` with a focused
  `workflow.test.ts` for the cadence and aggregation logic, per the
  workflows AGENTS.md conventions.

## Done When

- A new autonomy workflow under
  `src/modules/autonomy/workflows/` runs on a fixed cadence and emits one
  digest per window through the `notification` module.
- The digest covers the seven categories listed in Desired Outcome above
  with deterministic counts pulled from `.kota/runs/` metadata, the task
  tree, and the owner-questions store.
- A unit test exercises a fixture run window and asserts the rendered
  digest content; an integration test covers the cadence trigger.
- The notification payload is human-readable on every configured
  delivery channel (Telegram chat, Slack, push) without channel-specific
  branching in the workflow code.
- Module-local docs (`workflow/AGENTS.md` plus the workflow's own
  `AGENTS.md`) describe the cadence, the data sources it reads, and its
  relationship to the existing `attention-digest` workflow.

## Source / Intent

The most recent autonomy work (config-slice distribution, KotaClient
namespace refactor proposal, operator-CLI migration cluster, etc.) all
landed without the operator getting a single end-of-day summary of what
shipped. The owner has otherwise been pushing for KOTA to feel
"product-grade" rather than a black-box loop (see the 2026-04-25 inbox
reinforcement on CLI rendering, and the recurring approvals/owner-question
work). Surface visibility for completed work is the positive-side complement
to `attention-digest`'s exception-side reporting.

## Initiative

Operator observability for autonomous KOTA operation: the system should not
require scraping `.kota/runs/` and `git log` to know whether the loop is
producing value, churning, or stalled.

## Acceptance Evidence

- A live-run artifact under `.kota/runs/<digest-run-id>/` containing the
  rendered digest payload for at least one non-empty window and one empty
  window, demonstrating both "active" and "quiet" states.
- A captured Telegram (or Slack / push) message screenshot or transcript
  showing the digest delivered to a real channel, not just emitted to a
  test sink.
- Co-located workflow tests pass; the digest workflow appears in
  `pnpm kota workflow list` output.
