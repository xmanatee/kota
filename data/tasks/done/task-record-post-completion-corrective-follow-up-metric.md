---
id: task-record-post-completion-corrective-follow-up-metric
title: Record post-completion corrective follow-up metrics for autonomous tasks
status: done
priority: p2
area: autonomy
task_class: Safety
summary: Derive a compact post-completion signal from existing task, run, and follow-up evidence so KOTA can see when completed agent-authored work later creates corrective maintenance tasks instead of treating completion-time review as the whole quality story.
created_at: 2026-06-24T00:46:56.239Z
updated_at: 2026-06-24T01:05:09.985Z
---

## Problem

KOTA now records strong completion-time evidence for autonomous work:
review-scrutiny artifacts, trajectory diagnostics, control-monitor coverage,
progress reviews, workflow-failure escalation, and task acceptance evidence.
Those signals answer whether a run was reviewed and whether its stated checks
passed at completion time.

They do not answer a different operator question: after a task is marked
`done/`, does it later create corrective maintenance work? Today those
follow-ups appear as ordinary new tasks or progress-review findings. The
relationship back to the completed task, run, or commit is only visible to a
human reading source-intent prose and run references.

That leaves KOTA blind to a post-completion safety pattern: agent-authored work
that looked acceptable when closed, then repeatedly needs follow-up because of
regressions, source-size fallout, review-scrutiny repairs, security findings,
or missing evidence that surfaced only after the fact.

## Desired Outcome

Add a compact, deterministic post-completion corrective-follow-up diagnostic
for autonomous task work. The diagnostic should derive from existing task and
run evidence, not introduce a new reviewer.

At minimum, it should:

- scan recent `done/` tasks and currently open follow-up tasks for explicit
  references to task ids, run ids, git commits, evidence ids, or artifact paths;
- distinguish corrective follow-ups from planned siblings, decomposed subtasks,
  operator-capture blockers, and unrelated nearby work;
- classify corrective follow-ups with bounded reason codes such as
  `regression`, `security`, `review-scrutiny`, `trajectory-diagnostic`,
  `workflow-failure`, `source-size`, `missing-evidence`, or `operator-report`;
- expose a concise operator-facing report or JSON section with counts, linked
  task ids, source run/commit refs, and active follow-up ids; and
- keep the normal task queue authoritative: the diagnostic reports and links
  evidence, but does not reopen `done/` tasks automatically.

## Constraints

- Use existing task files, run artifacts, report aggregation, and explicit
  references in task bodies/frontmatter. Do not scrape hidden reasoning, raw
  prompts, large diffs, or terminal transcripts when structured references
  exist.
- Do not import AIDev, mine GitHub, or add an external PR/code-survival
  benchmark. The local response is a KOTA-run evidence diagnostic.
- Do not score individual operators, reviewers, or harnesses. The signal is
  queue quality and maintenance burden, not blame.
- Do not treat every follow-up as a failure. Planned decomposition, strategic
  blocked operator-capture tasks, and normal product fan-out must be excluded
  or labeled separately.
- Keep cost fields out of autonomy-facing outputs and operator report sections
  that summarize this diagnostic.
- Prefer focused fixtures and existing report tests over a broad historical
  migration.

## Done When

- A module-owned reader or report aggregator links recent completed tasks to
  later open corrective follow-up tasks using explicit task/run/commit/artifact
  references.
- The operator-facing report or JSON output includes a bounded
  post-completion corrective-follow-up summary with counts, reason codes,
  linked completed task ids, and active follow-up task ids.
- Focused tests cover at least:
  - a completed task whose later progress-review task cites the same run or
    commit and is counted as corrective;
  - a planned sibling or decomposed task that is not counted as corrective;
  - a blocked operator-capture task that remains excluded from corrective
    maintenance metrics; and
  - a source-size or review-scrutiny follow-up that is linked to its completed
    parent evidence.
- The report stays compact and omits cost fields.
- `pnpm run validate-tasks` passes.

## Product / Safety Link

This Safety task supports the Product claim that KOTA's autonomous development
loop is trustworthy from durable evidence, and the Safety concern that
agent-authored code should not be accepted only at completion time while later
corrective maintenance remains invisible.

## Source / Intent

Explorer run `2026-06-24T00-28-49-710Z-explorer-q7q18o` saw a thin queue:
two ready tasks, no backlog, and strategic blocked alternatives still gated on
operator-captured live evidence. The current ready queue is dominated by
review-scrutiny repair and source-size cleanup; adding another narrow
completion-time reviewer would duplicate existing work.

External sources checked:

- `https://arxiv.org/abs/2601.16809` ("Will It Survive? Deciphering the Fate of
  AI-Generated Code in Open Source", submitted January 23, 2026) studies the
  long-term fate of AI-generated code and argues that organizational practices
  govern its later evolution; its abstract reports a modestly elevated
  corrective modification rate for agent-authored code even though simple
  "disposable code" claims do not hold.
- `https://arxiv.org/abs/2602.09185` ("AIDev: Studying AI Coding Agents on
  GitHub", submitted February 9, 2026) introduces a large dataset of
  agent-authored pull requests across Codex, Devin, Copilot, Cursor, and Claude
  Code. The KOTA-relevant signal is not the dataset itself; it is that
  agent-authored work should be studied through lifecycle artifacts after PR
  creation, not only through the initial patch and review verdict.

Local overlap check:

- `task-record-autonomy-review-scrutiny-metrics` and generated
  review-scrutiny repair tasks make thin approval visible at review time, but
  they do not link completed tasks to later corrective maintenance.
- `task-write-trajectory-quality-diagnostics-for-workflow-` and trajectory
  escalation cover process warnings during or immediately after runs, not
  whether a closed task later produces corrective follow-up work.
- `progress-reviewer` already creates steering tasks from recent evidence, but
  the operator report does not summarize which completed tasks or commits are
  repeatedly producing follow-ups.
- `workflow-failure` and evaluator-calibration escalation handle runtime or
  evaluation drift; they do not provide a compact maintenance-burden view of
  completed autonomous task work.

The nonduplicative gap is a post-completion diagnostic that links later
corrective tasks back to the completed task evidence they came from.

## Initiative

Outcome-aware autonomy governance.

## Acceptance Evidence

- Diff showing the post-completion corrective-follow-up reader/report code and
  bounded reason-code classification.
- Focused fixture tests proving corrective, planned sibling, and
  operator-capture cases are classified correctly.
- `pnpm kota report` or JSON-mode output against fixture/local run artifacts
  showing the new summary with task/run/commit refs and no cost fields.
- `pnpm run validate-tasks` output showing the task queue remains valid.
- Implemented in `src/modules/autonomy/report/post-completion-followups.ts`
  with aggregation/render wiring in the existing autonomy report surface.
- Focused fixture coverage:
  `pnpm test src/modules/autonomy/report/post-completion-followups.test.ts`,
  `pnpm test src/modules/autonomy/report/render.test.ts`, and
  `pnpm test src/modules/autonomy/report/aggregate.test.ts`.
- Validation evidence: `pnpm run typecheck`, `pnpm run lint`, and
  `pnpm run validate-tasks` passed; task validation used a temporary Git index
  because this sandbox cannot write `.git/index.lock`.
- JSON-mode local report artifact:
  `.kota/runs/2026-06-24T00-33-42-793Z-builder-dp2llr/post-completion-followups-report.json`.
