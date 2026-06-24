---
id: task-add-agent-authored-logging-obligation-diagnostics
title: Add agent-authored logging obligation diagnostics
status: ready
priority: p2
area: modules
task_class: Platform
summary: Add deterministic diagnostics that flag agent-authored runtime changes missing structured logging or observability evidence, so logging obligations are not left to prompt-only review.
created_at: 2026-06-24T05:52:02.042Z
updated_at: 2026-06-24T05:52:02.042Z
---

## Problem

KOTA has strong run artifacts, structured daemon logs, tracing, and progress
review, but the autonomy loop does not currently have a deterministic way to
notice when an agent-authored runtime change creates or modifies an
observability obligation and leaves it to prose review. A builder can change a
workflow step, daemon route, tool runner, harness adapter, channel transport,
retry path, approval path, or recovery path without adding or preserving the
structured log/event/run-artifact/test evidence an operator will need when the
path fails later.

That gap matters because missing diagnostics are not usually caught by normal
correctness tests. They show up after deployment as opaque failed runs, noisy
post-completion follow-up, or human repair work.

## Desired Outcome

Add a focused, deterministic diagnostic that reviews agent-authored production
diffs for logging and observability obligations on runtime-sensitive surfaces.
The diagnostic should identify candidate changes such as new or changed error
handling, retry/recovery behavior, external calls, tool execution, approval or
permission decisions, channel delivery, daemon route handling, workflow step
state transitions, and agent-harness execution paths.

When a candidate change is found, the diagnostic should require inspectable
evidence that the outcome remains observable. Acceptable evidence can be an
existing or new structured log, typed event, run artifact, explicit error
result, focused test assertion over the observable output, or a short
run-artifact rationale explaining why no additional diagnostic signal is
needed.

Surface the result where autonomy reviewers and operators already look: the
builder/progress-review metadata, a run artifact, or the existing attention
path. The first version may be advisory, but it must be deterministic,
test-covered, and precise enough that recurring misses can become repair tasks
without manual log archaeology.

## Constraints

- Reuse existing tracing, logging, event, run-artifact, progress-review, or
  autonomy diagnostic surfaces. Do not add a parallel audit log, external
  service, or docs catalog.
- Keep the check scoped to runtime-sensitive production diffs. Do not warn on
  every code edit, task-file edit, test-only change, or pure refactor that does
  not alter failure/decision behavior.
- Prefer typed source/diff analysis or existing change metadata over broad
  substring matching. If a heuristic is unavoidable, keep it conservative and
  document the exact cases it covers in tests.
- Do not force noisy logging into normal success paths. The useful outcome is
  observable failures and decisions, not higher log volume.
- Keep secrets, approval inputs, credentials, and tool payloads out of any new
  diagnostic output.
- Do not make the first implementation depend on live model calls or external
  network access.

## Done When

- A deterministic diagnostic exists for agent-authored production diffs touching
  runtime-sensitive surfaces and emits a structured result naming each
  candidate file, why it was considered observability-sensitive, and what
  evidence satisfied or failed the obligation.
- Focused tests cover at least three cases:
  - a runtime error/retry/decision-path change with no observable signal is
    flagged;
  - the same shape with a structured log/event/run artifact/error-result or
    test assertion is accepted;
  - test-only or task-only changes do not warn.
- The diagnostic result is visible through an existing run artifact or review
  metadata path consumed by autonomy review/progress surfaces.
- A failing diagnostic can produce a clear follow-up task or attention item
  without requiring an operator to inspect raw agent logs manually.
- The implementation keeps any new diagnostic payload redacted and avoids
  storing raw tool inputs, approval payloads, tokens, or environment values.
- Relevant focused unit tests and task validation pass.

## Source / Intent

Explorer run `2026-06-24T05-37-33-953Z-explorer-mzmgtf` reviewed a thin queue
with only one actionable p3 maintenance task and five strategic blocked
alternatives that still require operator-captured evidence. Because
`inspect-queue.strategicReadyCoverageGap` was true, this run opened one p2
Platform task rather than leaving the near-term queue as maintenance-only.

External source checked:

- `https://arxiv.org/abs/2604.09409` ("Do AI Coding Agents Log Like Humans? An
  Empirical Study", submitted April 10, 2026) studies 4,550 agentic pull
  requests across 81 open-source repositories. Its abstract reports that coding
  agents change logging less often than humans in 58.4% of repositories,
  explicit logging instructions are rare and often ineffective, and humans
  perform 72.5% of post-generation log repairs. The KOTA-relevant signal is not
  to add more prompt text or generic log volume; it is to make observability
  obligations deterministic and artifact-visible when autonomous agents edit
  runtime-sensitive paths.

Local overlap check:

- KOTA already has structured daemon logs, JSON log mode, request-scoped MCP
  logging, workflow log search/follow, tracing, tool telemetry, run summaries,
  and progress review. Those surfaces make diagnostics possible but do not
  currently require an agent-authored runtime change to prove its failure or
  decision path remains observable.
- Existing review-scrutiny and post-completion corrective-follow-up tasks cover
  human/agent review quality and later repair metrics, not this narrower
  source-level observability obligation.
- Existing logging work is protocol- or operator-surface specific; this task is
  a cross-runtime diagnostic that turns logging/observability review from a
  prose expectation into deterministic evidence.

## Initiative

Observable autonomous runtime changes.

## Acceptance Evidence

- Diff showing the diagnostic implementation and focused tests.
- Test transcript for the diagnostic's focused suite.
- Task validation transcript showing the task queue remains valid.
- Example run artifact or review metadata sample showing a flagged
  observability obligation and an accepted one without exposing sensitive data.
