---
id: task-report-owner-intervention-pressure-in-autonomy-sum
title: Report owner-intervention pressure in autonomy summaries
status: done
priority: p2
area: autonomy
task_class: Safety
summary: Aggregate owner-question outcomes and free-form correction signals so operator reports show where autonomous work repeatedly needs owner intervention, times out, or receives corrective direction.
created_at: 2026-06-24T08:56:43.501Z
updated_at: 2026-06-24T09:18:09.805Z
---

## Problem

KOTA already has durable owner-question machinery: workflows can enqueue
bounded questions, wait through `askOwnerSteps`, persist pending/answered/
dismissed/expired queue records, and surface pending questions in daily
digests. The operator can inspect individual `.kota/owner-questions/*.json`
records, but the autonomy report does not answer a higher-level governance
question: which workflows repeatedly need owner intervention, which questions
time out, and where owner answers redirect or correct the autonomous system
instead of simply approving a proposed option.

That leaves a safety blind spot. A run can be technically successful while
leaving a pattern of stale pending owner questions, repeated timeouts, or
free-form owner corrections that never become visible as an aggregate quality
signal. Those cases are not the same as post-completion corrective tasks,
review-scrutiny thin acceptances, or source-size drift: they are points where
the autonomous loop needed human intervention before it could responsibly
continue, or where the owner had to steer it away from its proposed path.

## Desired Outcome

Extend the operator-facing autonomy summaries with a deterministic
owner-intervention pressure signal derived from existing owner-question
records and workflow artifacts.

At minimum, the signal should:

- read `.kota/owner-questions/*.json` and any matching workflow/run refs
  without adding a second owner-question store;
- group recent questions by source, origin workflow, task id when present,
  answer behavior, and status (`pending`, `answered`, `dismissed`,
  `expired`);
- classify answered questions into conservative outcome buckets such as
  `proposed-option`, `freeform-correction`, `provider-noise-dismissal`,
  `setup-action`, and `ambiguous-answer` using proposed-answer matching and
  bounded text classification rules;
- report timeout and stale-pending pressure separately from answered owner
  corrections so the operator can distinguish ignored prompts from explicit
  steering;
- include compact run/task/question refs in `kota report` and JSON mode while
  omitting raw owner-answer bodies by default; and
- tolerate legacy records that lack `origin` or `answerBehavior` by reporting
  them as legacy/unknown rather than crashing or inventing data.

## Constraints

- Reuse `OwnerQuestionQueue`, existing event/run references, and the autonomy
  report aggregation path. Do not add a parallel intervention ledger, metrics
  database, hidden reasoning reader, or external dataset import.
- Keep the classifier deterministic and conservative. Do not add an LLM judge
  over owner answers or try to infer private intent from long free-form text.
- Treat owner answers as sensitive operator content. Report status, bounded
  reason codes, source/workflow refs, and short redacted snippets only when a
  test proves secrets and long answers are not leaked.
- Do not duplicate blocked-promoter cadence handling. This task reports
  intervention pressure; blocked-promoter still owns owner-decision promotion
  and operator-capture instruction markers.
- Do not duplicate post-completion corrective follow-ups, review-scrutiny,
  trajectory diagnostics, diff-summary consistency, or code-health drift. This
  signal owns owner-question pressure and correction-like answers only.
- Keep the report operator-facing. Do not feed intervention pressure or
  answer bodies into later autonomy-agent prompts.

## Done When

- The autonomy report reader normalizes owner-question records into typed
  owner-intervention records with question id, status, created/resolved times,
  source, origin workflow/run/task refs, answer behavior, outcome bucket, and
  missing/legacy markers.
- `pnpm kota report` and JSON-mode output include an owner-intervention
  section with recent totals, stale-pending counts, timeout counts, answered
  correction counts, top source/workflow buckets, and compact refs.
- Focused tests cover at least:
  - an answered question matching a proposed answer;
  - an answered free-form correction or redirect that does not match proposed
    options;
  - an expired or timed-out workflow question;
  - a pending question old enough to count as stale;
  - a legacy record without origin/answerBehavior handled as unknown; and
  - report rendering that omits raw answer bodies, prompts, secrets, and cost
    fields.
- Existing daily-digest, blocked-promoter, autonomy-health-reviewer, and
  autonomy report tests still pass.
- `pnpm run validate-tasks` passes.

## Source / Intent

Explorer run `2026-06-24T08-38-08-839Z-explorer-atwu2j` saw
`strategicReadyCoverageGap=true`: the ready queue held only p3 maintenance
work, the backlog was empty, and the surfaced strategic blocked alternatives
all still required operator-captured live evidence.

Blocked strategic alternatives considered but not chosen:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` still requires the
  `.kota/runs/scientific-claim-reproduction-live-pass/` operator-captured live
  eval artifact.
- `task-add-algorithmic-resource-budget-canaries-to-the-ev` still requires the
  `.kota/runs/algorithmic-resource-budget-canary-live-pass/` operator-captured
  live eval artifact.
- `task-add-an-unfamiliar-language-strategy-construction-f` still requires the
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/` operator-
  captured live eval artifact.
- `task-add-cross-preset-runtime-parity-gate` still requires the
  `.kota/runs/preset-parity-all-keys-set/` operator transcript pair with real
  provider auth.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` still requires the
  all-registered-harness `.kota/runs/harness-parity-*` capture.

External source checked:

- `https://arxiv.org/abs/2605.29442` ("How Coding Agents Fail Their Users: A
  Large-Scale Analysis of Developer-Agent Misalignment in 20,574 Real-World
  Sessions", submitted May 28, 2026) studies real IDE and CLI coding-agent
  sessions through visible developer pushback. The abstract identifies
  recurring failure forms around project reading, intent interpretation, rule
  following, action bounds, implementation/execution, and progress reporting;
  it also reports that effort/trust costs dominate and most visible
  resolutions still require explicit user correction.

KOTA should not import the paper's session dataset or add a new human-review
system. The local nonduplicative signal is owner-question pressure: KOTA
already records when workflows ask for owner judgment and whether the answer
was proposed, free-form, expired, or pending, but that pressure is not
summarized for operators as autonomy quality evidence.

Local overlap check:

- `task-record-post-completion-corrective-follow-up-metric` links completed
  tasks to later corrective work, but it does not report owner questions that
  interrupted or redirected work before completion.
- `task-record-autonomy-review-scrutiny-metrics` counts reviewer scrutiny and
  thin acceptances, not owner intervention, stale questions, or free-form
  owner corrections.
- `task-record-builder-diff-summary-consistency-diagnostic` compares declared
  change summaries to actual diffs, but it does not inspect owner-question
  outcomes.
- `daily-digest` surfaces pending owner questions, while this task adds a
  recent-window aggregate over pending, answered, dismissed, expired, legacy,
  and correction-like outcomes.

## Initiative

Outcome-aware autonomy governance.

## Product / Safety Link

This Safety task supports the Product claim that KOTA's autonomous development
loop can be trusted from durable operator-facing evidence, and the Safety
concern that repeated human intervention, owner correction, or unanswered
owner prompts should not remain hidden behind successful workflow completion.

## Acceptance Evidence

- Diff showing the typed owner-intervention record, reader, report
  aggregation, report rendering, JSON output, and focused tests.
- Focused test transcript covering proposed-answer, free-form correction,
  expired, stale-pending, legacy, and sanitized-output cases.
- `pnpm kota report` or JSON-mode fixture output showing owner-intervention
  pressure totals and refs without raw answer bodies or cost fields.
- `pnpm run validate-tasks` output showing the task queue remains valid.
