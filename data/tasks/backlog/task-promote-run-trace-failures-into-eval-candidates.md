---
id: task-promote-run-trace-failures-into-eval-candidates
title: Promote run trace failures into eval candidates
status: backlog
priority: p2
area: modules
task_class: Meta
summary: Turn recurring run-artifact failures, trajectory diagnostics, and review-scrutiny findings into bounded eval-harness candidate fixtures before autonomy prompts, reviewers, or harnesses are changed.
created_at: 2026-06-25T14:51:40.590Z
updated_at: 2026-07-06T14:02:50.000Z
---

## Problem

KOTA has useful run traces, trajectory diagnostics, review-scrutiny metrics,
repair logs, and eval-harness fixtures. It does not yet provide a clean path
from "this failure pattern appeared in real autonomy traces" to "this is a
candidate regression fixture or eval scenario." That makes autonomy improvement
too dependent on manual memory: an agent can patch a prompt, reviewer, or
workflow after one observed failure without first preserving the pattern as a
repeatable evaluation target.

The research direction is clear: traces should feed evals before changes are
promoted. The local implementation needs to be bounded, redacted, and
duplicate-aware so it strengthens KOTA's eval harness without turning every run
artifact into permanent test data.

## Desired Outcome

Add a trace-to-eval-candidate operation for autonomy runs. It should inspect
recent run artifacts, trajectory diagnostic escalations, review-scrutiny
records, repair-loop failures, and workflow errors, then propose bounded eval
candidates with evidence references.

Candidate proposals should capture:

- source run id, workflow, task id, and artifact paths;
- the observed failure pattern or risky success pattern;
- why the pattern is worth preserving as a regression or capability eval;
- minimal fixture inputs that can reproduce the decision point without secrets,
  excessive logs, or full raw traces;
- suggested evaluator type: deterministic predicate, artifact schema check,
  trajectory check, model-graded rubric, or human-review checklist;
- duplicate/similarity references to existing eval fixtures and open tasks; and
- disposition: proposed, accepted into eval harness, rejected, duplicate, or
  needs-owner-evidence.

The first version can emit proposals and optionally open normalized KOTA tasks.
Permanent eval fixtures should still require an explicit accepted disposition
or builder-owned implementation work.

## Constraints

- Do not store hidden reasoning traces, secrets, credentials, or full raw event
  streams in eval candidates.
- Do not auto-import external benchmarks or papers as local fixtures. External
  sources can motivate a candidate, but local failures should define the
  fixture.
- Do not make a model judge the default evaluator. Prefer deterministic
  predicates and schema/trajectory checks when they can answer the question.
- Prevent fixture gaming and stale datasets by linking each accepted candidate
  to the concrete run evidence and source task.
- Avoid a parallel durable queue. Use existing task files, eval-harness
  fixtures, and run artifacts rather than a new state system.
- If a proposal requires operator-captured evidence, mark that explicitly
  instead of creating a ready-to-build fixture from missing data.

## Done When

- A CLI/report operation can scan recent autonomy run artifacts and output
  trace-derived eval candidate proposals.
- The operation detects at least: recurring trajectory warning, review-scrutiny
  thin acceptance, repair-loop failure, and workflow schema/validation failure.
- Candidate generation is duplicate-aware against existing eval fixtures and
  open/done tasks.
- Secret/redaction tests prove sensitive fields do not enter candidate outputs.
- At least one accepted candidate path can create or update a compact
  eval-harness fixture, or create a normalized task with artifact references
  for a builder to do so.
- Tests cover proposed, duplicate, rejected, and needs-owner-evidence
  dispositions.

## Source / Intent

Owner asked to research how KOTA can measure each autonomy decision and decide
whether the system became better. This task turns that principle into the
feedback loop that feeds eval coverage from real failures.

Research synthesis:

- LangChain's trace-first improvement loop treats production traces as the raw
  material for evals, targeted fixes, offline validation, and post-deploy
  monitoring.
- Anthropic's agent-eval guidance distinguishes capability evals from
  regression evals; trace-derived KOTA candidates should mostly start as
  regression candidates.
- Google's agent-evaluation guidance includes trajectory evaluation, not only
  final-answer grading.
- AgentLens, SpecBench, and METR reward-hacking work reinforce that trajectory
  quality, multi-round persistence, and hidden objective gaming need dedicated
  evaluation rather than final output checks alone.

Local mapping:

- Completed trajectory-diagnostic and review-scrutiny tasks create the signals
  this operation should consume.
- Existing model-matrix and eval-harness work already own scoring and fixture
  execution. This task only creates the candidate intake from real traces.

## Initiative

Trace-backed eval growth.

## Product / Safety Link

Safety: prevents recurring autonomy failures from being patched by memory or
prompt tweaks without preserving a replayable evaluation target. The safety
outcome is that real run-trace failures become bounded regression candidates
before reviewer, harness, or workflow behavior is promoted.

## Acceptance Evidence

- Transcript for the trace-to-eval candidate command or report mode against
  fixture run artifacts.
- Sample candidate artifact or normalized task showing source run references,
  redacted minimal inputs, evaluator suggestion, and disposition.
- Focused tests for duplicate prevention, redaction, and accepted candidate
  fixture/task creation.
