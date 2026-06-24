---
id: task-record-builder-diff-summary-consistency-diagnostic
title: Record builder diff-summary consistency diagnostics
status: ready
priority: p2
area: autonomy
task_class: Safety
summary: Add deterministic diagnostics that compare autonomous builder completion summaries, commit messages, and changed-file evidence against the actual diff so misleading or underspecified change descriptions become visible in operator reports.
created_at: 2026-06-24T08:08:48.717Z
updated_at: 2026-06-24T08:08:48.717Z
---

## Problem

KOTA now records strong completion-time signals for autonomous work: task state
movement, critic verdicts, review-scrutiny records, trajectory diagnostics,
code-health drift, post-completion follow-up links, run summaries, commit
messages, and changed files. Those signals still leave a narrower honesty gap:
the operator cannot quickly tell whether a builder's declared change summary
matches the actual diff shape.

The current critic can reject an individual misleading completion, and the
improver semantic gate checks commit-message honesty for improver runs. But
there is no deterministic, reportable artifact for ordinary builder runs that
compares the final commit message, task completion prose or run summary, changed
files, and diff-derived change classes. A terse or misleading summary can
therefore pass through as a one-off judgment problem and never become an
operator-visible trend.

This matters because autonomous quality reports now steer queue decisions. If a
run claims "fix review-scrutiny metrics" while the diff mostly adds task-file
churn, broad formatting, generated baselines, or unrelated surface cleanup, the
operator should see that mismatch as a durable diagnostic instead of discovering
it by reading individual diffs.

## Desired Outcome

Add a compact deterministic diff-summary consistency diagnostic for autonomous
builder completions.

At minimum, the diagnostic should:

- derive bounded diff facts from existing git/run artifacts, such as changed
  top-level areas, changed module names, production/test/task/doc buckets,
  added/deleted file counts, large-diff or baseline-file flags, and whether the
  final task file moved to `done/`;
- read the run summary and commit message already written by the workflow, plus
  task id/title/summary when available;
- compare declared scope against the diff-derived facts with conservative
  rule-based checks, flagging mismatches such as summary terms that name a
  module not touched, broad source churn hidden by a narrow message, task-only
  movement with no implementation evidence, or baseline/generated-file changes
  omitted from the declared summary;
- write a small run artifact such as `diff-summary-consistency.json` for
  builder runs and include a compact section in `kota report` or JSON-mode
  output with counts, mismatch categories, run/task refs, and missing-data
  counts; and
- keep the signal advisory at first unless an existing repair-loop gate already
  rejects the same defect.

## Constraints

- Use deterministic parsing of existing task files, run summaries, commit
  messages, changed files, and bounded diff metadata. Do not add an LLM judge,
  external dataset import, GitHub miner, hidden reasoning reader, or full
  semantic similarity model.
- Do not import AIDev or scrape GitHub PRs. The local response is KOTA-owned
  run evidence over KOTA's own autonomous completions.
- Keep false positives low. A concise commit message is acceptable when the
  changed-file facts do not contradict it; missing metadata should be reported
  as missing, not inferred from prose.
- Do not duplicate review-scrutiny, code-health drift, post-completion
  follow-up, source-size, or observability-obligation checks. This diagnostic
  owns declared-summary-vs-diff consistency only and can reuse their records as
  context.
- Keep prompts, raw tool payloads, full diffs, costs, and credentials out of
  the report output. Store only bounded facts and run/task references.

## Done When

- Builder completions produce or expose a typed diff-summary consistency record
  that includes declared summary text, bounded diff facts, mismatch categories,
  missing-data markers, and run/task refs.
- The operator autonomy report and JSON output include a compact
  diff-summary-consistency section or quality-signal row with totals, mismatch
  counts, top examples, and missing metadata counts.
- Focused tests cover at least:
  - a clean run whose commit message and task title match the changed module
    and file buckets;
  - a task-only or task-dominant completion that claims an implementation fix;
  - a narrow summary hiding broad production or generated/baseline churn;
  - missing run summary or commit message handled as explicit missing metadata;
    and
  - report rendering that omits full diffs, prompts, raw tool payloads, costs,
    and secrets.
- `pnpm run validate-tasks` passes with this task present.

## Source / Intent

Explorer run `2026-06-24T07-55-23-905Z-explorer-zm4eu3` saw
`strategicReadyCoverageGap=true`: the ready queue held only p3 cleanup work and
all surfaced strategic blocked alternatives still required operator-captured
live evidence. This p2 Safety task restores a near-term strategic autonomy item
without pretending those blockers can move.

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

- `https://arxiv.org/abs/2601.17581` ("How AI Coding Agents Modify Code: A
  Large-Scale Study of GitHub Pull Requests", submitted January 24, 2026 and
  last revised April 6, 2026) studies merged agentic PRs from the AIDev dataset
  and compares code-change shape with PR descriptions. KOTA should not import
  the dataset or mine GitHub. The local signal is narrower: KOTA's own
  autonomous completion summaries and commit messages should be checked against
  bounded diff facts so operators can see when declared scope diverges from
  actual change shape.

Local overlap check:

- `task-record-autonomy-review-scrutiny-metrics` counts approval-like decisions
  and thin evidence, but does not compare declared change summaries with actual
  diffs.
- `task-record-post-completion-corrective-follow-up-metric` links completed
  tasks to later corrective work, but only after follow-up exists.
- `task-stratify-autonomy-quality-metrics-before-comparing` stratifies existing
  quality signals, but does not add a summary-vs-diff signal.
- The improver semantic gate checks commit-message honesty for improver diffs;
  ordinary builder completions do not emit a deterministic reportable record for
  the same class of mismatch.

## Initiative

Outcome-aware autonomy governance.

## Product / Safety Link

This Safety task supports the Product claim that KOTA's autonomous development
loop can be trusted from durable run artifacts, and the Safety concern that
agent-authored changes should not be accepted or summarized more narrowly than
their actual repository impact.

## Acceptance Evidence

- Diff showing the typed diff-summary consistency model, builder/run artifact
  writer or reader, report aggregation, text rendering, JSON output, and focused
  tests.
- Focused test transcript for the clean, task-only, broad-churn, missing-
  metadata, and sanitized-output cases.
- `pnpm kota report` or JSON-mode fixture output showing the new consistency
  section with mismatch counts and run/task refs.
- `pnpm run validate-tasks` output showing the task queue remains valid.
