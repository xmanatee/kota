---
id: task-add-loop-quality-audits-for-autonomous-workflows
title: Add loop quality audits for autonomous workflows
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Audit autonomy workflow loops for explicit completion checks, stopping brakes, context hygiene, safe retries, and independent verifier signals.
created_at: 2026-06-24T15:44:37.109Z
updated_at: 2026-07-06T20:38:12.904Z
---

## Problem

KOTA has a sophisticated workflow runtime, repair loops, critic/improver
judgment, cooldowns, budgets, and evals. The Akshay Pachaar loop-engineering
article still exposes a useful audit lens: reliable loops fail most often on
stopping conditions, context rot, tool ambiguity, unsafe retries, and missing
verifiers.

Those concerns are spread across KOTA today. Some are enforced by workflow
validators, some by autonomy docs, some by individual prompts, and some by
reviewer judgment. There is no focused loop-quality audit that inspects an
autonomy workflow and reports whether it has the core brakes and verifier
signals expected of a long-running loop.

## Desired Outcome

Add a deterministic audit surface for autonomous workflow loop quality. The
first version should inspect workflow definitions and adjacent module metadata,
then produce actionable findings for:

- explicit completion/done criteria rather than agent self-report;
- iteration, time, cost, cooldown, or retry brakes where the loop can repeat;
- no-progress or repeated-call detection for loops that can spin;
- context hygiene strategy such as run artifacts, fresh-session handoff,
  bounded summaries, or subtask isolation;
- mutating-tool retry safety or idempotency expectations;
- independent verifier/critic/test evidence before "done"; and
- human-in-the-loop gates for irreversible or high-risk effects.

The audit can start as a CLI/health-review artifact and later graduate to a
stronger gate once false positives are understood.

## Constraints

- Keep the surface in `src/modules/autonomy/` or a closely owned module. Do not
  add another workflow engine or graph DSL.
- Do not replace critic/improver judgment with brittle source heuristics. Static
  checks should flag missing objective rails; judgment-heavy review remains
  agent-backed with artifacts.
- Do not add hard daily spend caps to core autonomous workflows by default.
  KOTA standards say to fix queue, prompts, validation, repair flow, or operator
  controls before capping healthy workflows.
- Avoid hardcoded workflow-name inventories. Use workflow definitions,
  triggers, step shapes, tags, and declared module metadata where possible.
- Do not leak cost/operator report details into agent prompts.
- Keep warnings actionable and suppressible only through typed evidence, not
  "ignore this" prose.

## Done When

- A loop-quality audit command, health-reviewer check, or equivalent runtime
  artifact inspects autonomy workflows and returns typed findings.
- At least builder, improver, dispatcher, research-retry, and one event-driven
  workflow are covered by focused tests or fixture inputs.
- The audit detects representative missing rails: no completion evidence,
  repeatable loop without a brake, mutating action without retry/idempotency
  posture, and verifier-less "done" paths.
- Existing healthy workflows either pass or produce documented, actionable
  warnings with evidence references.
- Tests cover findings, non-findings, deterministic output, and no workflow-name
  self-trigger regression.

## Source / Intent

Owner asked on 2026-06-24 to turn recent agent-system resources into KOTA tasks
that improve the project, with references left for future agents to research.

Source resources to reread:

- https://x.com/akshay_pachaar/status/2069118430582866051
- https://openai.com/index/codex-maxxing-long-running-work/
- https://jxnl.co/writing/2026/05/10/codex-maxxing/

The X article was readable through an authenticated browser on 2026-06-24. Its
KOTA-relevant claims were: the basic model/tool/context loop is easy; the hard
parts are stopping correctly, keeping context clean, making tools usable and
safe to repeat, and adding something independent that can say no.

Local mapping:

- `src/modules/autonomy/AGENTS.md` already documents generator/evaluator
  separation, artifact-first critic input, context resets, runtime probes, and
  external pattern decisions.
- `src/modules/autonomy/workflows/AGENTS.md` owns workflow routing,
  self-trigger risk, recovery, and repair-loop rules.
- `src/modules/eval-harness/` owns outcome-grade regression fixtures.

## Initiative

Reliable autonomy loops: KOTA should verify that its self-running workflows
stop, retry, remember, and escalate for explicit reasons.

## Product / Safety Link

Safety: closes the repeated daemon reliability blocker where long-running
autonomy can cycle, retry, or park without objective stop, verifier, and
dispatch signals. The owner-visible safety outcome is lower runaway cost,
clearer operator state, and fewer self-improvement loops accepted on agent
self-report alone.

## Acceptance Evidence

- Audit output artifact under `.kota/runs/<run-id>/` showing findings and
  non-findings for representative workflows.
- Focused test transcript for the audit classifier and workflow fixtures.
- If surfaced through CLI, a transcript showing the command output with stable
  finding ids and evidence paths.
