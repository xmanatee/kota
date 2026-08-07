---
id: task-validate-agy-model-routing-against-long-horizon-co
title: Validate AGY model routing against long-horizon coding evidence
status: ready
priority: p1
area: architecture
task_class: Platform
summary: Make AGY model selection evidence-driven for KOTA coding and autonomy rather than relying on model-family labels or literal configuration assertions.
created_at: 2026-08-07T01:04:26.755Z
updated_at: 2026-08-07T01:04:26.755Z
---

## Problem

The Antigravity preset previously routed `fast` and `balanced` work to
Gemini 3.6 Flash but `capable`, which every autonomy workflow consumes, to
Gemini 3.1 Pro. That made the nominal quality tier select the weaker model for
the long-horizon coding, terminal, and execution-loop behavior KOTA actually
needs. The mapping has now been corrected to Gemini 3.6 Flash at maximum
effort, but the decision still needs KOTA-owned behavioral evidence so a model
family label or future vendor release cannot silently reverse it.

Literal assertions over the preset object are not evidence that the selected
model plans carefully, follows repository instructions, limits its scope, or
finishes a coding task. The owner has also observed Google models rushing,
skipping examples and guidelines, and making unrelated edits. Those failure
modes must be measured directly.

## Desired Outcome

Add one reusable AGY model-selection evaluation that runs the available Google
candidates through the same representative KOTA workloads and records:

- planning quality and use of supplied examples and local instructions;
- implementation correctness and final verification;
- long-horizon repair completion and terminal/tool-loop discipline;
- requested versus unrelated changed paths;
- unsupported assumptions, unnecessary artifacts, and unwanted edits;
- trajectory warnings, retries, elapsed time, and terminal disposition.

Use the resulting evidence to confirm or revise the Antigravity preset. The
preset registry remains the single shipped source of model and effort mapping;
the evaluation verifies behavior and runtime propagation, not literal source
text.

## Constraints

- Keep reasoning at the highest AGY-supported setting for every candidate.
- Do not prefer a model because it is cheaper or produces fewer tokens.
- Do not add a second model-routing registry or per-workflow model literals.
- Fail visibly when the requested model or effort is unavailable; never fall
  back to another model.
- Use isolated fixtures and inspectable run artifacts. Do not use the live
  canonical queue as benchmark input.
- Treat instruction adherence and unrelated edits as first-class failures even
  when the final checks pass.

## Done When

- A repeatable command evaluates at least planning, scoped coding, and
  long-horizon repair scenarios through the real `antigravity-cli` adapter.
- Each scenario records the requested and observed model/effort, trace,
  changed-path scope, verification result, and rubric verdict.
- The selected AGY model wins or ties the relevant coding/autonomy criteria and
  has no unexplained scope or instruction-adherence regression.
- Doctor/readiness rejects an unavailable selected model before autonomy
  dispatch.
- Preset resolution tests prove selection and propagation behavior without
  freezing declarative model values in unit-test expectations.

## Source / Intent

Owner direction on 2026-08-07: use Gemini 3.6 Flash rather than 3.1 Pro for
AGY-backed KOTA, choose the strongest long-horizon coding behavior, and pay
special attention to Google models rushing, ignoring examples or guidelines,
and introducing unrelated changes.

The rollout review found that the old `capable` mapping selected 3.1 Pro even
though public and local evidence favored 3.6 Flash for agentic coding. This
task turns that one-time correction into repeatable behavioral evidence.

## Initiative

Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- A run directory under `.kota/runs/<run-id>/agy-model-routing/` containing the
  scenario definitions, per-candidate traces, changed-path reports,
  verification output, rubric verdicts, and final routing decision.
- A transcript showing the selected model and maximum effort reaching the real
  AGY process without fallback.
