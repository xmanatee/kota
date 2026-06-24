---
id: task-classify-ci-and-integration-failures-in-post-compl
title: Classify CI and integration failures in post-completion follow-up metrics
status: done
priority: p2
area: autonomy
task_class: Safety
summary: Extend the autonomy report's post-completion follow-up diagnostic so CI, build, and integration-test breakage after a task is marked done is classified as a distinct corrective-maintenance signal.
created_at: 2026-06-24T02:21:58.978Z
updated_at: 2026-06-24T02:39:26.475Z
---

## Problem

KOTA now reports post-completion corrective follow-ups for recent autonomous
builder work, with reason codes for regression, security, review-scrutiny,
trajectory diagnostics, workflow failure, source size, missing evidence, and
operator-report signals. That covers a useful slice of maintenance burden, but
it does not separate a common agentic failure mode: work that looked acceptable
at task completion and then produced CI, build, or integration-test breakage.

Those failures should not be hidden under generic `regression` or
`operator-report` counts. They are the point where locally accepted
agent-authored work fails at integration boundaries, and operators need to see
that pattern distinctly when judging whether KOTA's completion-time checks are
strong enough.

## Desired Outcome

Extend the post-completion follow-up diagnostic so open tasks that explicitly
cite a recent completed task/run/commit and describe CI, build, test-suite, or
integration-test failure are classified with a new bounded reason such as
`ci-build-failure`.

The report should preserve the existing behavior for generic regressions while
making integration breakage independently countable in the operator-facing
summary and JSON output.

## Constraints

- Build on `src/modules/autonomy/report/post-completion-followup-*`; do not
  add a second report path, external benchmark, hidden-history miner, or LLM
  reviewer.
- Keep matching deterministic and evidence-linked. A task should count only
  when it has an explicit link to the completed task evidence and a clear
  CI/build/integration failure signal in its normalized task text.
- Keep blocked operator-capture tasks and planned siblings excluded as they
  are today.
- Keep cost fields out of this report surface.
- Do not reclassify every test-related task as a failure. Planned test
  expansion, harness fixture work, and acceptance-evidence tasks should remain
  outside the new reason unless they describe a broken CI/build/integration
  outcome after completion.

## Done When

- `POST_COMPLETION_FOLLOW_UP_REASONS` includes a distinct
  CI/build/integration failure reason and the report renderer can display it.
- `classifyCorrectiveReasons` detects explicit signals such as failing CI,
  broken build, failed integration tests, or post-merge test-suite breakage
  without treating ordinary test additions as failures.
- Focused fixture tests prove:
  - a linked follow-up task citing failed CI/build/integration evidence is
    counted under the new reason;
  - a generic regression without CI/build wording remains a regression only;
  - a planned test-expansion sibling is not counted; and
  - blocked operator-capture follow-ups stay excluded.
- `pnpm kota report` or JSON-mode report output against a fixture/local run
  shows the new reason count without cost fields in the follow-up section.
- `pnpm run validate-tasks` passes.

## Product / Safety Link

This Safety task supports the Product claim that KOTA's autonomous development
loop can be trusted from durable evidence, and the Safety concern that work
accepted from local completion checks should not hide later integration
breakage.

## Source / Intent

Explorer run `2026-06-24T02-00-49-683Z-explorer-j5lgp5` saw a thin queue with
only one p3 ready task and five strategic p2 blocked alternatives, all still
waiting on operator-captured evidence. The run could not honestly promote those
blocked tasks and needed an actionable p2 strategic item.

External source checked:

- `https://arxiv.org/abs/2601.15195` ("Where Do AI Coding Agents Fail? An
  Empirical Study of Failed Agentic Pull Requests in GitHub", submitted January
  21, 2026; accepted at MSR 2026) studies 33k agent-authored GitHub PRs. Its
  abstract reports that not-merged agentic PRs tend to be larger, touch more
  files, and often fail CI/CD validation; its qualitative taxonomy also names
  duplicate PRs, unwanted feature implementations, weak reviewer engagement,
  and agent misalignment as rejection patterns.

Local overlap check:

- `task-record-post-completion-corrective-follow-up-metric` just shipped the
  local lifecycle diagnostic inspired by `https://arxiv.org/abs/2601.16809`.
  It already avoids importing AIDev or an external code-survival benchmark, but
  its reason taxonomy does not include CI/build/integration failure as a
  distinct post-completion signal.
- Existing review-scrutiny and trajectory diagnostics make weak acceptance
  visible around review time. They do not answer whether a completed task later
  produced integration breakage that should be counted separately from generic
  regressions.
- Eval-harness fixtures grade candidate behavior inside controlled scenarios;
  this task is about KOTA's own completed autonomous work and its follow-up
  queue, not adding another live-builder fixture.

The nonduplicative gap is a small extension to the existing operator report so
CI/build/integration failure after task completion is visible as its own
corrective-maintenance reason.

## Initiative

Outcome-aware autonomy governance.

## Acceptance Evidence

- Diff showing the new reason code, deterministic detection rules, and report
  rendering/JSON support.
- Focused tests in
  `src/modules/autonomy/report/post-completion-followups.test.ts` cover linked
  CI/build failure, generic regression, planned test-expansion sibling
  exclusion, blocked operator-capture exclusion, and explicit CI/build/
  integration-test wording.
- Report output artifact:
  `.kota/runs/2026-06-24T02-31-29-135Z-builder-8lw26z/report-output.json`;
  checked by
  `.kota/runs/2026-06-24T02-31-29-135Z-builder-8lw26z/report-output-check.txt`.
- Validation run:
  `pnpm test src/modules/autonomy/report/post-completion-followups.test.ts src/modules/autonomy/report/render.test.ts`.
- Validation run: `pnpm run typecheck`.
- Validation run: `pnpm exec biome check ...` on touched report files.
- Validation run: `GIT_INDEX_FILE=<temporary-index> pnpm run validate-tasks`.
  The real-index `pnpm run validate-tasks` run reported only the sandbox
  staging blocker for the ready-to-done task move.
