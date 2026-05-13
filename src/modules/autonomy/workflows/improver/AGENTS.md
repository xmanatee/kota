# Improver Workflow

This directory contains the improver workflow definition and prompt.

- This workflow should improve the autonomous process itself using evidence from recent runs.
- Keep this workflow focused on protocol, prompts, validation, and docs/process quality.
- Correct strategic drift, over-scaffolding, and bad incentives at the root instead of adding more local patches.
- Prefer lightweight validations and repair loops over brittle workflow-coded bookkeeping.
- If tasks or prompts become too procedural, simplify them back
  to clear goals, constraints, and lightweight rails.
- A no-op run is correct when the run-outcome data and recent runs show no
  systemic pattern worth addressing. Make no changes and stop. The commit step
  already no-ops on an empty diff, and the semantic gate skips without staged
  changes. Do not invent preventive or speculative edits to avoid exiting clean.
- The evidence gate (`latestActionableRunAt` in `run-outcome-aggregation`)
  counts a non-improver run as actionable only when it failed terminally.
  Recovered repair trips on successful runs are intentionally excluded —
  self-healing already worked, and the repair-check aggregate
  (`topRepairFailures`) still surfaces the pattern when improver next wakes
  on a genuine failure. Do not re-broaden actionability to recovered repair
  trips: doing so drove a ~52% no-op rate on agent runs (39/75 measured
  runs, ~$117 of wasted agent spend).
- Duration outliers in successful runs are also excluded from the actionable
  signal. 24h evidence around 2026-04-25 showed five of six successful
  improver runs were driven by terminal failures; the only outlier-only
  trigger (run `2026-04-24T20-36-26-240Z-improver-7fhk26`) spent $2.14
  confirming an SDK api_retry stall was a one-off transport blip and
  no-oped. The next outlier-only candidate after the 75-min metrics-route
  migration (run `2026-04-25T09-23-21-272Z-builder-2jc8dl`,
  `latestActionableRunAt = 2026-04-25T10:38:20.295Z`) was the change that
  retired this trigger. Outlier rows still ship to the agent in
  `durationOutliers` so they can be inspected when improver fires on a real
  failure.
- Agent-step wall-clock timeouts and classified provider transport failures
  are likewise excluded from the actionable signal. Around 2026-05-04 a
  single SDK transport outage hit five consecutive autonomous runs
  (`2026-05-03T12-38-42-870Z-builder-18hn1h`,
  `2026-05-03T15-45-42-243Z-decomposer-y7gom0`,
  `2026-05-03T19-49-39-479Z-improver-1vzoz9`,
  `2026-05-03T22-52-39-315Z-improver-fqo7wk`,
  `2026-05-04T08-01-44-733Z-improver-3b34za`); every one stalled with the
  same shape (a single `api_retry` between meaningful frames, no `result`
  frame, the run sum never finalized) and burned the full
  `AUTONOMY_AGENT_HANG_TIMEOUT_MS` slot before the rail fired. On
  2026-05-13, Codex CLI transport disconnects during repair and remote
  compaction (`2026-05-13T16-44-46-506Z-improver-sz290m`,
  `2026-05-13T22-48-15-016Z-builder-il7v2b`) had the same autonomy signal
  shape. Editing prompts, validators, or queue shaping cannot fix a stuck
  upstream stream, so the gate ignores those runs while keeping timeout rows
  visible in `agentStepTimeouts7d` for review on the next real-evidence
  pass. The runtime fix (an inactivity watchdog at the executor) belongs to
  a builder task, not this workflow.

## Doc-Bloat Repair Check

`doc-bloat-check` runs in this workflow's repair loop (and in builder's)
as a deterministic gate over staged AGENTS.md/CLAUDE.md/docs additions.
It rejects three concrete bloat shapes: drawn directory trees, prose
narrating renames or version history, and file-path bullet dumps beyond
a small budget. The underlying conventions stay in the root
`AGENTS.md`/`CLAUDE.md`; this check is the enforcement surface so they
do not silently drift across autonomous runs. Judgment-heavy doc-quality
calls remain with the semantic gate and the critic.

## Evidence Attachment

Improver is the autonomous distillation mechanism for this repo: systemic
patterns seen in run evidence should graduate into durable `AGENTS.md` guidance
at the narrowest applicable scope.

When an improver commit adds, changes, or retracts a rule based on recent
runs, the commit message must cite the driving evidence — run IDs,
repair-check IDs, or other concrete signals from `.kota/runs/` or run-outcome
aggregates. This is the commit-linked evidence contract that lets a later
reviewer trace the rule back to the traces that justified it.

Prefer editing the narrowest applicable `AGENTS.md`. Do not accumulate
subtree-specific guidance at the repo root.

When an improver commit touches the "External Pattern Decisions" catalog in
`src/modules/autonomy/AGENTS.md`, update the matching entry in
`src/modules/autonomy/external-pattern-decisions.ts` in the same commit. New
verdicts require a sidecar entry with source, ISO date, KOTA primitives, and
a concrete revisit condition; the catalog test fails 1:1 match otherwise.
