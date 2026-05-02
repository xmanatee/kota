---
id: task-raise-explorer-idea-quality-and-shape-empty-queue-
title: Raise explorer idea quality and shape empty-queue loop
status: done
priority: p1
area: modules
summary: Improve explorer so it more often proposes high-leverage, strategic, architecture-improving work when the queue is thin instead of small p2 fan-out, and reshape the empty-queue explorer-builder loop without adding blunt daily spend caps.
created_at: 2026-04-28T22:04:35.308Z
updated_at: 2026-05-02T17:25:37.477Z
---

## Problem

The 2026-04-28 broad daemon review found two related symptoms in the
empty-queue cycle:

- Explorer research is useful and the watchlist is high quality, but recent
  outputs skew toward small p2 surface-completion tasks once the queue is
  empty.
- The empty-queue cycle frequently becomes: dispatcher sees empty/thin queue
  → explorer creates one task → builder ships one task → repeat. Recent run
  stats since 2026-04-27 show 1,429 runs, 1,425 successes, and about $501 of
  agent cost (builder ~$393, explorer ~$103).

Together these mean autonomy stays reliable but defaults to narrow fan-out
instead of advancing the architecture front, and the loop's economics are
shaped almost entirely by emergent behavior.

## Desired Outcome

When the queue is thin, the explorer-builder loop preferentially advances
strategic, architecture-improving work — promoting/decomposing existing
blocked architecture tasks where they already exist, and proposing
high-leverage new work when they do not. Narrow fan-out tasks are not
prohibited, but they are no longer the default empty-queue output. Loop
shape (cadence, batching, skip conditions) is intentional rather than
emergent, while keeping current reliability and honest source handling.
The repo rule that autonomy improves queue/prompt/validation quality before
defaulting to hard caps stays intact.

## Constraints

- Do not add blunt daily spend caps as the primary control. Improve queue
  shaping, prompt quality, validation, repair flow, or operator controls
  before falling back to caps.
- Preserve honest source handling: inaccessible sources must still block,
  not produce speculative tasks.
- Do not silently degrade reliability. Recent reliability (~99.7% success)
  is the floor.
- Keep the existing explorer/decomposer/builder/critic separation; do not
  introduce a parallel automation engine.
- Idea-quality decisions must be inspectable in run artifacts, not buried
  inside agent traces.
- The strategic/fan-out heuristic must not rely only on task `area`; recent
  report output showed some surface-parity tasks classified as strategic
  because they were filed under `modules`. The workflow should inspect task
  intent, title/body, affected surfaces, and blocked alternatives.

## Done When

- Explorer's thin-queue behavior demonstrably shifts toward
  strategic/architecture work: it can choose to promote or decompose an
  existing blocked architecture task instead of opening unrelated narrow
  work, and its run artifacts make that decision visible.
- Explorer output for new work carries an explicit rationale comparing its
  proposal against existing blocked architecture work.
- The empty-queue loop's cadence, batching, or skip behavior reflects an
  explicit policy rather than emergent dispatcher → explorer → builder
  thrash. The chosen mechanism is documented in the autonomy module's
  scoped `AGENTS.md`.
- Acceptance evidence shows before/after run-stat comparisons demonstrating
  fewer narrow fan-out tasks and at least one example of explorer choosing
  a strategic blocker over new fan-out work.
- Empty `ready/` is treated as a queue-health event that requires selection,
  promotion, re-scope, or an explicit no-op reason; it is not treated as an
  automatic invitation for builder to consume backlog in order.

## Source / Intent

2026-04-28 broad daemon review (verbatim, idea quality): "explorer research
is useful and the watchlist is high quality, but recent outputs skew toward
small p2 surface-completion tasks once the queue is empty. Desired outcome:
Improve explorer so it more often proposes high-leverage, strategic,
architecture-improving work when the queue is thin... It should still
preserve honest source handling and avoid speculative tasks from
unread/gated resources."

2026-04-28 broad daemon review (verbatim, loop shape): "the empty-queue
cycle often becomes: 1. dispatcher sees empty/thin queue 2. explorer creates
one task 3. builder ships one task 4. repeat. Recent run stats since
2026-04-27: 1,429 runs, 1,425 successes, about $501 agent cost. Builder
consumed about $393 and explorer about $103. Desired outcome: Assess whether
the loop should batch more strategically, raise the bar for explorer-
generated work, or slow/shape empty-queue churn without adding blunt daily
spend caps."

These two captures address the same dynamic and would be solved together;
this task carries both intents.

2026-04-29 follow-up analysis found the queue at 10 backlog, 8 blocked, 0
ready, and 0 doing while builder runs continued. The same report classified
77 explorer-created tasks as strategic and 25 as fan-out, but the underlying
list still included surface-parity work under non-client areas. That makes the
heuristic useful but insufficient as the only quality signal.

## Initiative

Autonomy queue and idea quality: the empty-queue loop should advance the
architecture front instead of accumulating narrow fan-out, while preserving
reliability and honest source handling.

## Acceptance Evidence

- Run-directory artifact comparing pre/post run stats (priority/area mix,
  strategic vs fan-out share, builder cost split) using existing
  `.kota/runs/` data.
- At least one captured explorer run that promotes/decomposes an existing
  blocked architecture task rather than seeding an unrelated narrow task,
  with the decision rationale visible in the run artifact.
- Documentation update under `src/modules/autonomy/AGENTS.md` describing
  the loop-shaping mechanism chosen.
- A queue-health fixture proving empty-ready/backlog-present causes an
  intentional promotion or no-op reason rather than silent backlog consumption.
