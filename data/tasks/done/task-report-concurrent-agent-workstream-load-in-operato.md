---
id: task-report-concurrent-agent-workstream-load-in-operato
title: Report concurrent agent workstream load in operator reports
status: done
priority: p1
area: autonomy
task_class: Product
summary: Add an operator-visible supervision-load section that summarizes concurrent KOTA workstreams, pending human decisions, and overload warnings from existing runtime artifacts so parallel autonomy remains inspectable.
created_at: 2026-07-07T18:31:57.812Z
updated_at: 2026-07-07T18:52:06.806Z
---

## Problem

KOTA now supports parallel autonomy, active task claims, pending-merge
recovery, approval queues, owner questions, attention digests, and quality
reports. Those surfaces are individually inspectable, but the operator still
has to mentally combine them to answer a practical question: how many
agent-backed workstreams are currently asking for supervision, and is the
system creating more concurrent cognitive load than the operator can review
well?

That matters because parallel agents shift work from "do this one task" to
"supervise many partially autonomous workstreams." If KOTA only reports final
quality, cost, or task balance, it can miss an overload state where several
pending merges, approvals, owner questions, dead letters, or active runs are
all competing for attention. In that state, review scrutiny can drop and
valuable Product or Safety work can stall behind unclear operator load.

## Desired Outcome

Add an operator-visible supervision-load section to `kota report`, the daily
or attention digest, or the existing autonomy report pipeline. The first
version should summarize a bounded recent window using existing artifacts:

- active workflow runs and claimed tasks, grouped by workflow, task class,
  priority, and project or scope when available;
- pending-merge claims, blocked claim-recovery records, owner questions,
  approvals, open dead letters, and attention items that require human action;
- completed workstreams still awaiting review-quality evidence, rendered
  Product evidence, or merge/claim cleanup;
- a compact load score or status such as `normal`, `busy`, or `overloaded`,
  with the threshold and contributing counts shown plainly; and
- direct run/task references for the top items creating supervision load.

The report should help the operator decide whether to start more autonomy,
pause dispatch, clear pending decisions, or let the queue stay empty until the
current workstreams are resolved. It should not attempt to infer private
mental effort; it should report observable KOTA workstream pressure.

## Constraints

- Use existing runtime state, task claims, task files, approval/owner-question
  stores, dead-letter records, run artifacts, attention-digest inputs, and
  report aggregation. Do not add a second workstream database or manual
  operator-load ledger.
- Keep the section operator-only. Do not expose supervision-load, cost, or
  "operator is overloaded" signals back into autonomy agent prompts.
- Keep thresholds deterministic and configurable or locally documented. The
  first version can use conservative defaults, but it must print which counts
  tripped a warning.
- Treat missing stores or unavailable daemon state honestly as
  `unknown` / `not available`, not as zero load.
- Avoid raw transcript scraping, hidden reasoning, secret values, or broad
  prompt summaries. References and bounded counts are enough.
- Do not block workflow execution from this report alone. Any future dispatch
  gate would need a separate measured autonomy-change decision.

## Done When

- `kota report` or the existing report JSON includes a supervision-load section
  with bounded counts, status, threshold metadata, and top run/task references.
- The report accounts for at least active runs, active or pending-merge task
  claims, approvals, owner questions, open dead letters, and attention items
  when those stores are present.
- Missing or unreadable stores render as explicit unknown evidence rather than
  zero-load success.
- Focused tests or fixtures cover normal load, overloaded load, pending-merge
  load, missing store evidence, multi-project or multi-scope grouping when
  available, and JSON plus rendered text output.
- The implementation keeps all supervision-load details in operator-facing
  reports and does not add them to agent prompts or queue-shaping context.

## Source / Intent

Explorer run `2026-07-07T17-54-24-111Z-explorer-9abycf` observed an empty
dispatchable queue where the only ready task was unclaimable because a builder
claim was still `pending-merge`. The strategic blocked alternatives surfaced
by `inspect-queue` were all `operator-capture` tasks with `movable: false`, so
creating a fresh actionable Product task is preferable to fabricating movement
on blocked evidence.

External source checked:

- `https://arxiv.org/abs/2606.26959` ("The Shift to Agentic AI: Evidence from
  Codex") was submitted on 2026-06-25. Its useful KOTA signal is that agentic
  usage increasingly involves users managing multiple concurrent agents and
  more complex work, with more than 10 percent of users managing three or more
  Codex agents in a week and long-task requests rising sharply. KOTA should
  translate that into local operator-load visibility, not import the paper's
  usage pipeline or turn it into a benchmark.

Local overlap check:

- `task-expose-planning-versus-execution-decision-attribut` reports decision
  ownership and hard success/trouble evidence; it does not summarize current
  supervision load across active and waiting workstreams.
- `task-report-process-discipline-scores-from-trajectory-d` projects process
  quality from trajectory diagnostics; it does not tell the operator how many
  concurrent streams need attention now.
- `task-add-atomic-task-claim-leases-for-parallel-autonomy` and
  `task-enable-guarded-parallel-builder-dispatch-with-conf` protect runtime
  concurrency; they do not expose an operator-facing workload summary.
- Attention and daily digest surfaces roll up messages, but they do not compute
  a supervision-load status from claims, approvals, owner questions, dead
  letters, and active runs together.

## Initiative

Operator-visible autonomy supervision.

## Product / Safety Link

Product: helps the operator supervise parallel KOTA work without manually
reconstructing active, pending, and blocked workstreams from many surfaces.
Safety: makes review-load pressure visible before overloaded supervision
weakens approval, merge, or task-completion scrutiny.

## Result

`kota report` now renders a Supervision load section and the structured report
JSON includes `supervisionLoad`. The section reads the existing runs directory,
task-claim files, approval files, owner-question files, dead-letter queue,
attention detector, review-scrutiny counts, and post-completion follow-up
links. Missing or unreadable stores are reported as unknown evidence instead of
zero counts, and focused fixtures cover normal, overloaded, pending-merge,
missing/unreadable, multi-scope, JSON, and rendered output cases.

## Acceptance Evidence

- `.kota/runs/2026-07-07T18-36-34-787Z-builder-drzwm4/report-transcript.txt`
  shows `pnpm kota report` rendering the Supervision load section with status,
  counts, unknown store evidence, and top references.
- `.kota/runs/2026-07-07T18-36-34-787Z-builder-drzwm4/supervision-load-report.json`
  is parseable `kota report --json` output with `supervisionLoad.counts`,
  `status`, threshold weights, unknown-store evidence, and top references.
- `.kota/runs/2026-07-07T18-36-34-787Z-builder-drzwm4/focused-test-transcript.txt`
  shows the focused report tests passing, including normal load, overloaded
  load, pending-merge load, missing/unreadable store evidence, multi-scope
  grouping, JSON output, and rendered text output.
- `src/modules/autonomy/report/supervision-load.ts` reads existing report,
  task, run, claim, approval, owner-question, dead-letter, and attention
  surfaces without adding an agent-prompt path.
