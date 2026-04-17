# Autonomous Learning

How KOTA accumulates durable learnings from its own autonomous runs.

## Model

Three surfaces cover the full loop:

1. **`AGENTS.md` — durable guidance.** Scoped at the narrowest applicable
   directory. Agents read these automatically at session start via
   `loadInstructionContext`, which walks up the directory tree from the
   working directory and injects every `AGENTS.md` / `CLAUDE.md` it finds.
2. **`.kota/runs/` — evidence traces.** Every run has a directory with
   `metadata.json`, `run-summary.json`, step outputs, agent logs, commit
   messages, repair-check traces, and `error.txt` when applicable. This is
   the authoritative record of what happened.
3. **Git history — implementation record.** What changed, when, by whom,
   and why. Commit messages are the durable narrative.

There is no separate "lessons" store, per-run journal, or knowledge silo.
Durable guidance lives in `AGENTS.md`; evidence lives in `.kota/runs/`;
history lives in `git`.

## Distillation

The **improver** workflow is the autonomous distillation mechanism.

- It triggers on monitored workflow completions and aggregates recent run
  outcomes (failure rates, repair-check tallies, duration outliers) in the
  `gather-run-data` step.
- Based on recurring signals, it edits `AGENTS.md` at the narrowest relevant
  scope (module, workflow, or subtree) rather than accumulating guidance
  at the root.
- When improver adds or changes a rule motivated by evidence, the commit
  message names the driving run IDs or repair-check IDs so a reviewer
  (human or agent) can trace the rule back to concrete traces. This is the
  evidence-attachment convention.

## Promotion criteria

A signal should be promoted into `AGENTS.md` when:

- Multiple runs exhibit the same failure mode, repair-check hit, or
  agent mistake within the recent window (24h/7d aggregates are sufficient
  to detect this).
- The pattern is not already covered by existing `AGENTS.md` guidance at
  any level above the chosen scope.
- The rule can be stated as durable guidance, not as a workaround for a
  one-off incident.

Single-run anomalies stay in `.kota/runs/` until recurrence shows they are
systemic.

## Retraction criteria

Improver should remove or rewrite a rule when:

- Observed behavior no longer matches the rule (e.g. the underlying
  invariant changed or a better mechanism superseded the guidance).
- Two rules give conflicting guidance.
- A rule names a concrete file, function, or flag that no longer exists.
- A rule is narrower than the scope it sits in and now belongs deeper in
  the tree.

Retraction uses the same commit-linked evidence convention: the commit
message explains what was retracted and why, citing the runs or traces
that demonstrate the rule is stale.

## Why no separate recall step

Earlier iterations injected a `recall-knowledge` step into the agent
prompt of each autonomy workflow, feeding summaries of past runs. This
duplicated what the agent already had: the scoped `AGENTS.md` context
comes in through `loadInstructionContext`, and the per-run journal was
redundant with git history and `.kota/runs/`. The duplication added
prompt bloat without adding signal, so the recall step was removed.

Agents that need to read `.kota/runs/` directly (e.g. improver inspecting
repair-check traces, decomposer inspecting the failed build) can do so
with the normal Read / Grep tools.
