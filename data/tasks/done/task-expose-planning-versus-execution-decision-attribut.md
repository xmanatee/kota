---
id: task-expose-planning-versus-execution-decision-attribut
title: Expose planning-versus-execution decision attribution in autonomy reports
status: done
priority: p2
area: autonomy
task_class: Product
summary: Report how much recent agent sessions leave planning decisions to the owner versus execution decisions to KOTA, with hard success and trouble signals, so operator reports can catch overdelegation and weak success evidence.
created_at: 2026-07-01T16:59:00.945Z
updated_at: 2026-07-01T17:32:46.000Z
---

## Problem

KOTA's operator reports already surface task balance, quality warnings, owner
intervention pressure, review scrutiny, and dead-letter state. They still do
not answer a practical operator question: when recent agent sessions succeeded
or struggled, did the owner supply the planning decisions while KOTA executed,
or did KOTA start making planning choices without enough owner/domain context?

Anthropic's June 16, 2026 Claude Code usage study adds a useful product lens:
real coding-agent sessions show a planning/execution split, hard success
signals matter more than self-reported completion, and task-specific expertise
changes whether users recover from trouble. KOTA should turn that into a local
reporting capability, not a new benchmark or durable research catalog.

## Desired Outcome

Add an operator-visible decision-attribution section to `kota report`, the
autonomy quality packet, or an equivalent existing report surface. For a recent
window of KOTA sessions or autonomy runs, it should report:

- work mode or task class for each classified session;
- estimated planning-decision attribution: owner, KOTA, mixed, or unknown;
- estimated execution-decision attribution: owner, KOTA, mixed, or unknown;
- hard success signals such as committed task completion, passing validation,
  accepted critic verdicts, rendered Product evidence, or explicit owner
  acceptance;
- trouble signals such as failed tests, repair-loop exhaustion, owner
  corrections, dead letters, repeated retries, or abandoned work; and
- aggregate warnings when KOTA appears to make planning decisions without
  corresponding owner/domain context or when "success" lacks hard evidence.

The report should be useful during progress review and owner steering. It
should help distinguish healthy delegation ("owner decides what, KOTA decides
how") from risky overdelegation or weak success evidence.

## Constraints

- Use existing session, run-artifact, task, owner-intervention,
  review-scrutiny, and progress-report surfaces. Do not add a second transcript
  store, metrics ledger, or external-link catalog.
- Do not inspect, store, or summarize hidden reasoning traces. Classify only
  visible prompts, tool/run artifacts, task state transitions, and existing
  review/report artifacts.
- Keep classifier uncertainty explicit. Unknown or insufficient evidence is a
  valid output and should not be silently coerced into owner or KOTA.
- Do not make a model judge the only source of truth for success. Hard success
  and trouble signals must be grounded in existing artifacts where available.
- Keep cost, latency, and operator-only diagnostics out of agent prompts.
- Avoid broad transcript scraping during normal runs unless the operator
  explicitly asks for it or the report window is bounded.

## Done When

- A report builder or report section classifies a bounded recent window of
  agent sessions/autonomy runs into planning attribution, execution
  attribution, work mode or task class, hard success signals, and trouble
  signals.
- The existing operator report surface renders aggregate counts and the most
  actionable warnings with run/task references.
- Tests or fixtures cover owner-planned/KOTA-executed work, KOTA-planned work,
  mixed attribution, unknown attribution, hard success with evidence, and
  claimed success with only weak evidence.
- Product-task evidence rules still apply: the report does not treat green
  implementation tests as sufficient proof for Product work without rendered
  operator-journey evidence.
- The implementation documents, in the local owning code or AGENTS guidance,
  which artifacts are valid inputs and why hidden reasoning is out of scope.

## Source / Intent

Explorer run `2026-07-01T16-38-45-452Z-explorer-tl3nl8` refreshed the
Anthropic research watchlist page and found a new June 16, 2026 report:

- https://www.anthropic.com/research/claude-code-expertise

The source analyzes roughly 400,000 Claude Code sessions and introduces a
framework for interactive coding-agent usage: work mode, planning versus
execution decision attribution, task-specific expertise, hard success signals,
and trouble/recovery signals. The KOTA-relevant lesson is to measure how
delegation is actually happening in local sessions and to require hard evidence
for success, not to import Anthropic's classifier or create another benchmark.

Local overlap check:

- `task-report-owner-intervention-pressure-in-autonomy-sum` already reports
  explicit owner correction pressure; it does not classify planning versus
  execution decision ownership.
- `task-record-autonomy-review-scrutiny-metrics` already measures weak
  reviewer scrutiny; it does not identify who made the meaningful task
  decisions.
- `task-add-measured-autonomy-change-promotion-decisions` will record rollout
  decisions for autonomy changes; this task supplies an operator-facing signal
  those decisions can use.
- `task-add-source-to-decision-coverage-report-for-agent-r` will map research
  sources to local decisions; this task is the nonduplicative local reporting
  capability from this source.

## Initiative

Operator-visible autonomy quality: KOTA should show whether its agents are
being delegated execution with adequate owner intent, or drifting into planning
without the hard evidence and domain context needed to trust the result.

## Acceptance Evidence

- Transcript under `.kota/runs/<run-id>/` for the chosen operator report
  command showing the new decision-attribution section with run/task
  references and aggregate warnings.
- Focused test transcript or fixture output showing the six attribution and
  evidence cases from `## Done When`.
- Sample report artifact that includes at least one hard-success session, one
  trouble/recovery session, and one unknown-attribution session without
  exposing hidden reasoning or raw private transcript content.
