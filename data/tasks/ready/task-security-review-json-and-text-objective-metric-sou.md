---
id: task-security-review-json-and-text-objective-metric-sou
title: Security review: JSON and text objective-metric sources are agent-controlled filesystem entries, but the evaluator follows symbolic links and reads the entire target on the host without a size limit. An isolated agent can leave a metric path pointing at a host file, or create a large sparse metric artifact, causing unauthorized host reads or evaluator/daemon memory exhaustion after the container exits. The new failed-run collection path attempts these reads even when the fixture has already failed.
status: ready
priority: p1
area: security
task_class: Safety
summary: JSON and text objective-metric sources are agent-controlled filesystem entries, but the evaluator follows symbolic links and reads the entire target on the host without a size limit. An isolated agent can leave a metric path pointing at a host file, or create a large sparse metric artifact, causing unauthorized host reads or evaluator/daemon memory exhaustion after the container exits. The new failed-run collection path attempts these reads even when the fixture has already failed.
created_at: 2026-07-26T09:54:27.245Z
updated_at: 2026-07-26T09:54:27.245Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/objective-metrics.ts
claim:

> JSON and text objective-metric sources are agent-controlled filesystem entries, but the evaluator follows symbolic links and reads the entire target on the host without a size limit. An isolated agent can leave a metric path pointing at a host file, or create a large sparse metric artifact, causing unauthorized host reads or evaluator/daemon memory exhaustion after the container exits. The new failed-run collection path attempts these reads even when the fixture has already failed.

## Desired Outcome

> Treat metric artifacts as untrusted boundary inputs: require relative contained paths, reject symlinks and non-regular files using an O_NOFOLLOW-style open plus fstat, enforce a small maximum logical size before allocation, and parse from the validated descriptor to avoid races. Preserve typed metric errors without embedding untrusted file contents, and add regressions for symlinked host targets and large sparse artifacts on both passing and failed runs.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-26T09-17-25-790Z-security-review-2unzg0.

finding id: security-review-objective-metric-unbounded-artifact-read
candidate id: tool-execution:src/modules/eval-harness/objective-metrics.ts:1
verdict: confirmed
rationale:

> objective-metrics.ts:209-225 validates metric paths only as non-empty strings. Its JSON and text readers at lines 334-383 use statSync, which follows symlinks, followed by unbounded readFileSync calls. The agent receives a writable bind-mounted working directory under subprocess-executor-command.ts:91-111, so it can leave a symlink or oversized sparse file that the host evaluator resolves after container execution. Lines 612-633 attempt the same extraction for failed outcomes, extending the exposure to unsuccessful fixture runs.

Evidence:

Evidence 1:



path: src/modules/eval-harness/objective-metrics.ts

line: 334

excerpt:



> extractJsonFileMetric joins the declared path, validates it with statSync—which follows symlinks—and then calls readFileSync without an artifact-size bound.

Evidence 2:



path: src/modules/eval-harness/objective-metrics.ts

line: 369

excerpt:



> extractTextFileMetric uses the same follow-link and unbounded readFileSync sequence before applying its numeric pattern.

Evidence 3:



path: src/modules/eval-harness/objective-metrics.ts

line: 612

excerpt:



> For failed outcomes, evaluateObjectiveMetricsForOutcome still iterates every metric and invokes evaluateObjectiveMetrics against the mutated working directory.

Evidence 4:



path: src/modules/eval-harness/runner-single-fixture.ts

line: 205

excerpt:



> Metric extraction runs in the evaluator after workflow execution and predicate evaluation, outside the fixture executor's resource profile.

Evidence 5:



path: src/modules/eval-harness/fixtures/builder-source-grounded-research-synthesis/fixture.json

line: 74

excerpt:



> A shipped JSON metric reads research-synthesis-result.json, an output path explicitly allowed to be created or replaced by the builder.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
