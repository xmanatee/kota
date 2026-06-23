---
id: task-record-autonomy-review-scrutiny-metrics
title: Record autonomy review scrutiny metrics
status: ready
priority: p2
area: autonomy
task_class: Meta
summary: Persist deterministic scrutiny metrics for autonomy and PR review artifacts so rising approvals with thin evidence become visible before reviewer habituation turns into silent acceptance.
created_at: 2026-06-23T20:35:23.517Z
updated_at: 2026-06-23T20:35:23.517Z
---

## Problem

KOTA already has several reviewer-shaped autonomy surfaces: the builder critic
writes `critic-review.json`, progress-reviewer writes bounded evidence reviews,
the semantic gate writes judge artifacts, and `pr-reviewer` drafts advisory
GitHub review comments. These reviews can pass, approve, or report "on-track"
without any single deterministic artifact telling an operator how much evidence
or issue-finding work the review actually exposed.

That leaves a governance blind spot. A reviewer can become more permissive over
time while still producing schema-valid outputs, and today the operator must
inspect individual run directories to notice a pattern such as more approvals
with fewer cited evidence ids, warnings, follow-up tasks, or concrete PR
comments.

## Desired Outcome

Add a module-owned review-scrutiny diagnostic for autonomy reviewer outputs.
For each supported reviewer artifact or step output, normalize a small record
that includes:

- reviewer surface (`critic`, `progress-reviewer`, `pr-reviewer`, and any
  existing semantic-gate artifact that already uses the critic verdict shape);
- run id, workflow name, generated timestamp, and task id or PR reference when
  available;
- decision (`pass`, `pass_with_warnings`, `fail`, `on-track`,
  `needs-steering`, `blocked`, `insufficient-evidence`, `approve`, or
  `request-changes`);
- deterministic scrutiny signals such as evidence id count, finding or issue
  count, warning count, follow-up task count, review body length, and cited
  file/line count where the source artifact exposes them; and
- a conservative `thinAcceptance` flag for approval-like decisions whose
  source artifact contains no issues, warnings, follow-ups, cited evidence, or
  other configured scrutiny signal.

Make the signal visible to operators without turning it into an automatic
blocker on day one. A focused report surface should summarize recent reviewer
counts, approval-like decisions, thin-acceptance counts, and run references
that need inspection. Existing old run artifacts should be tolerated as
"unsupported" rather than rewritten.

## Constraints

- Use deterministic parsing of existing artifacts and workflow step outputs.
  Do not add an LLM reviewer, prompt-only instruction, hidden reasoning trace,
  or human-maintained audit spreadsheet.
- Keep the implementation inside autonomy-owned/report-owned surfaces. Do not
  create a parallel workflow engine, task state, or durable lesson store.
- Treat `thinAcceptance` as a diagnostic, not proof of a bad review. Concise
  valid approvals must remain possible; the report should point to evidence for
  inspection rather than failing unrelated runs.
- Keep thresholds explicit, conservative, and covered by tests. If a metric is
  unavailable for a reviewer surface, report that absence instead of inventing a
  proxy from free-form prose.
- Do not re-open or rewrite historical run artifacts. Backfill only by reading
  them during report aggregation.

## Done When

- A typed parser/aggregator can read recent `.kota/runs/*` reviewer artifacts
  and return normalized review-scrutiny records for the supported reviewer
  surfaces.
- New reviewer runs that already write structured review artifacts also write
  or expose a `review-scrutiny` record without changing the reviewer prompts or
  requiring agent self-reporting.
- The operator report includes a concise review-scrutiny section or JSON field
  with total reviews, approval-like decisions, thin acceptances, unsupported
  artifact counts, and run references for the current window.
- Focused tests cover at least: a critic pass with warnings, a progress-reviewer
  `on-track` review with cited evidence, a progress-reviewer `on-track` review
  with no findings/evidence that is flagged thin, a PR `approve` body with
  concrete file references, and malformed/old artifacts that are counted as
  unsupported rather than crashing the report.
- Existing autonomy report tests and the relevant reviewer workflow tests still
  pass.

## Source / Intent

Explorer run `2026-06-23T20-18-03-684Z-explorer-xd3x92` reviewed a thin queue
with `strategicReadyCoverageGap: true`. The surfaced strategic blocked tasks
were all still waiting on operator-captured live artifacts, so they could not
honestly move to `ready/`.

External source checked:

- `https://arxiv.org/abs/2606.22721` ("Habituation at the Gate: Rising
  Approval and Declining Scrutiny in Human Review of AI Agent Code", submitted
  June 21, 2026) studies repeat reviewers of AI-agent pull requests. The paper
  reports a rise in approval rates alongside lower inline comment volume and
  higher queue latency, interpreting the combination as reviewer habituation
  under workload rather than simple trust calibration.

Local mapping:

- KOTA should not import the paper's dataset or add a second review system.
  The nonduplicative local gap is observability: reviewer artifacts should make
  approval-like decisions with little visible scrutiny countable across runs.
- Existing critic calibration catches some pass/fail contradictions after later
  failure evidence appears. It does not report a broader operator-facing trend
  of increasingly thin approvals across critic, progress-reviewer, semantic
  gate, and PR review surfaces.
- The current ready queue contains only p3 source-size cleanup, so this p2
  strategic task restores near-term autonomy governance coverage without
  competing with the operator-capture blockers.

## Initiative

Outcome-aware autonomy governance.

## Product / Safety Link

This Meta task supports the Product claim that KOTA's autonomous work can be
trusted from run artifacts, and the Safety concern that agent-authored code
should not be silently accepted as reviewer workload rises.

## Acceptance Evidence

- Diff showing the typed review-scrutiny record, parser/aggregator, and any
  per-run writer integration.
- Transcript for focused parser/report tests covering the required thin and
  non-thin cases.
- Transcript for the relevant reviewer workflow tests touched by the change.
- `pnpm kota report` or its JSON mode showing the new review-scrutiny summary
  against fixture or local run artifacts, with run references visible.
