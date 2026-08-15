---
id: task-replace-autonomy-escalators-with-issue-driven-ai-r
title: Replace autonomy escalators with issue-driven AI review
status: ready
priority: p0
area: autonomy
task_class: Meta
depends_on: [task-validate-resolved-workflow-agent-capabilities-befo, task-make-autonomy-issues-a-durable-lifecycle-projectio]
summary: Remove completion-wide escalator scans and direct improver edits in favor of one AI disposition per materially changed durable issue.
created_at: 2026-08-06T20:22:00.325Z
updated_at: 2026-08-15T10:39:57.742Z
---

## Problem

Four code-only escalator workflows scan broad rolling windows after every
monitored `workflow.completed`: workflow failures, trajectory diagnostics,
review scrutiny, and owner intervention. `improver` also wakes after every
monitored completion, rebuilds overlapping aggregate evidence, and may edit and
commit autonomy code directly. Runtime recovery fans these workflows out again.

In the exact latest 200 completed runs audited on 2026-08-06, the four escalators
accounted for 92 runs and one material action. `improver` ran 10 times; two AI
invocations consumed 29.5 agent-minutes and produced no commit. Over seven
days, improver ran 131 times, made about 86 agent starts, and produced five
commits. The loops are individually bounded, but ownership is duplicated and a
single failure is repeatedly rediscovered by several rolling scans.

This also creates a second implementation path: builder implements queue tasks,
while improver can independently modify the same production surfaces from an
aggregate diagnosis.

## Desired Outcome

Replace completion-wide escalation and direct improver implementation with one
issue-driven decision path. Cheap source-owned detectors publish typed
observations into the durable issue lifecycle. Exactly one AI reviewer runs
when an issue is new, reopened, or materially revised and lacks a current
disposition. It may create/update one work proposal, ask the owner, mark the
issue observed, or resolve it. All source implementation then flows through a
normal task and builder.

## Constraints

- Preserve useful deterministic detection logic, but invoke it at the event
  that owns the fact: failed/interrupted run, trajectory diagnostic output,
  scrutiny result, owner-question change, DLQ change, or daemon/module health
  observation. Do not scan every successful workflow completion.
- Delete the four escalator workflow definitions and their duplicated
  inspect/action/artifact/commit/attention scaffolding once source-owned
  observations cover their facts. Do not retain compatibility workflows.
- Replace or repurpose improver so it performs issue disposition only. It must
  not write source code, run an implementation repair loop, or commit product
  changes; builder remains the single implementation path.
- Runtime recovery may replay/reconcile observations, but it may enqueue an AI
  review only when the durable projection changes. It must not fan out every
  recovery-capable reviewer.
- Add one shared generated-work proposal materializer for the redesigned
  issue, progress, and scope reviewers. It must use a stable proposal key,
  search every task state and owner-question state, preserve provenance, and
  create, update, resolve, or drop the existing record instead of using
  title-only dedupe or evidence-fingerprint task suffixes.
- Keep domain-specific task creators such as security review or decomposition
  separate when their contracts differ. The goal is one mechanism for this
  shared reviewer action, not a generic abstraction over unrelated domains.
- Emit operator attention only for lifecycle transitions that require notice:
  open/escalate, task/question creation or change, and resolution. Repeated
  evidence must not repeat attention.
- Do not add fixed cooldowns, iteration counters, or periodic safety scans as a
  substitute for semantic issue identity.

## Done When

- `workflow list` no longer contains the four escalator workflows, and no
  replacement listens to generic successful `workflow.completed` events.
- A replay of the passive-Codex incident creates one durable issue, one AI
  disposition, and at most one linked task/question. Repeated run ids and DLQs
  enrich that issue without another review or attention item.
- The latest-200-run fixture no longer generates the 92 escalator executions;
  every issue-review execution cites a unique issue transition that required a
  decision.
- Improver cannot edit or commit source. A proposed repair enters the normal
  task lifecycle and is implemented only by builder.
- The current progress-reviewer DLQs are linked to one issue and resolved or
  dismissed through evidence from commit `532ab1ae`, without hand-maintained
  duplicate records.
- The shared proposal materializer deduplicates across ready, doing, backlog,
  blocked, done, dropped, and owner questions, and a changed disposition
  updates the same stable record.
- Source-owned detector, restart replay, material-change, no-op repeat, and
  proposal lifecycle fixtures prove the end-to-end path.

## Source / Intent

Owner request and deep autonomy productivity audit on 2026-08-06. The owner
explicitly prefers a simpler agentic system: deterministic code should record
facts and protect final invariants, while capable agents should interpret
ambiguous evidence. The current architecture does the reverse in places: many
hardcoded rolling scanners repeatedly classify the same evidence, while the AI
improver has a broad parallel mutation path. This task removes those duplicate
paths rather than tuning their schedules.

## Initiative

One autonomy issue, one decision, one implementation path.

## Product / Safety Link

This Meta repair protects Product and Safety throughput by stopping repeated
control-plane scans and parallel source edits from consuming the only agent
slot or creating conflicting work while Product and Safety tasks wait.

## Acceptance Evidence

- A before/after replay report for the same latest-200-run fixture lists
  workflow invocations, issue transitions, AI decisions, attention items, and
  generated work records.
- A trace from one injected workflow failure through observation, issue
  projection, AI disposition, task creation, builder eligibility, and explicit
  issue resolution proves the single path.
- Source searches and workflow validation output show the four escalator
  definitions and direct improver commit path are absent.

## Operator Capture (2026-08-15)

The trusted canonical event journal and dead-letter store retain both missing
inputs. The capture under
`.kota/runs/2026-08-13T10-59-08-563Z-builder-tq9ibo/evidence/artifacts/production-routing-source/`
contains the exact ordered 200-row audit window and all four original DLQ
records. Each DLQ was already dismissed on 2026-08-06 with commit `532ab1ae`
and two subsequent successful production runs as evidence, so no further DLQ
mutation is required. The exact rows also correct the earlier retained
aggregate: `improver` occurred 10 times, not 11.

The remaining work is builder-owned acceptance: replay the captured rows through
the candidate routing and record workflow invocations, issue transitions, AI
decisions, attention items, and generated work in the same evidence directory.
