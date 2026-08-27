---
status: done
---

# Add measured autonomy change promotion decisions

## Problem

KOTA already has several good ingredients for autonomy governance: trajectory
diagnostics, review-scrutiny metrics, eval-harness fixtures, harness-parity
runs, artifact-first critic input, and pass@k/pass^k language in local docs.
Those pieces still do not force an autonomy change to record a hypothesis,
baseline, candidate evidence, rollout mode, and explicit promote/hold/rollback
decision.

That gap matters most for changes to prompts, workflow routing, evaluator
criteria, repair loops, reviewer/critic gates, and model or harness migration.
A single green run, a convincing critic note, or a lower operator cost is not
enough evidence that an autonomy behavior got better. KOTA needs a normalized
decision artifact so agents can compare before/after results and later explain
why a change was promoted, held, rolled back, or left in shadow mode.

## Desired Outcome

Add a typed autonomy-change decision artifact and report surface. The artifact
should be written for material changes to autonomy workflows, prompts, harness
logic, model routing, semantic reviewers, or critic/improver gates, and should
capture:

- affected surfaces and change class;
- the hypothesis or risk being tested;
- source references or local task ids that motivated the change;
- baseline run, fixture, or report references;
- candidate run, fixture, or report references;
- metrics that were actually compared, such as pass@k/pass^k, trajectory
  warnings, review-scrutiny signals, regression failures, runtime, cost, and
  latency;
- rollout mode: fixture-only, shadow, advisory, blocking, canary, promoted, or
  rolled back;
- decision: `promote`, `hold`, `rollback`, or `needs-more-data`; and
- concise rationale, owner/safety exceptions, and follow-up task ids.

The operator report should make the latest autonomy decisions visible without
requiring manual inspection of every `.kota/runs/<run-id>/` directory. The same
schema should be usable by future tasks that evaluate non-builder reviewers,
alternate models, or loop-quality gates.

## Constraints

- Do not depend on the OpenAI Evals hosted product. It is useful source
  material, but the public guidance says the legacy Evals platform becomes
  read-only on 2026-10-31 and shuts down on 2026-11-30.
- Do not add another durable lesson store, changelog, or external link catalog.
  The decision artifact should reference existing run artifacts, tasks,
  watchlist entries, and eval fixtures.
- Do not leak cost, latency, or operator-only report fields into agent prompts.
- Do not block urgent Product or Safety fixes on a completed evaluation when
  the safer path is an immediate fix plus follow-up measurement.
- Keep small-sample comparisons honest. Record uncertainty and missing
  evidence instead of pretending every prompt change has statistical proof.
- Use existing eval-harness, harness-parity, report, and run-artifact surfaces
  where possible.

## Done When

- A schema, parser, writer, and report reader exist for
  `autonomy-change-decision` artifacts.
- At least one focused fixture covers an autonomy prompt, workflow, reviewer,
  or harness change moving through baseline, candidate, and decision states.
- The operator report shows recent autonomy decisions with run references,
  compared metrics, rollout mode, and decision.
- Validation rejects malformed decisions and missing required evidence fields
  for material autonomy changes.
- Tests cover at least `promote`, `hold`, `rollback`, and `needs-more-data`
  decisions, including a case where a candidate looks cheaper or faster but
  loses on task quality.

## Source / Intent

Owner asked on 2026-06-25 to research how multi-agent systems and critics
should be built, then "migrate and measure every decisions" so KOTA can decide
whether changes actually became better.

Research synthesis:

- Anthropic's agent-eval guidance treats agent evaluation as a mix of
  code-based, model-based, and human grading, with separate capability and
  regression evals.
- OpenAI's eval guidance says evals are essential when upgrading models or
  changing prompts, but the hosted legacy Evals platform should not be the
  dependency for new KOTA work.
- Google's agent-evaluation guidance separates final-response evaluation from
  trajectory evaluation, which maps directly to KOTA's outcome and run-artifact
  surfaces.
- LangChain's agent-improvement-loop guidance starts from traces, enriches them
  with feedback/evals, applies targeted changes, runs offline evals, then
  watches production traces.

Local mapping:

- `src/modules/autonomy/AGENTS.md` already requires generator/evaluator
  separation, artifact-only critic input, runtime probes, and pass@k/pass^k
  awareness.
- Existing tasks cover loop-quality audits, trajectory diagnostics,
  review-scrutiny metrics, model-matrix evidence, and session replay. This task
  adds the missing decision record that ties those signals together.

## Initiative

Evidence-backed autonomy changes.

## Product / Safety Link

Safety: prevents prompt, workflow, harness, model-routing, and reviewer changes
from being promoted after one convincing run or vague critic approval. The
owner-visible safety outcome is that autonomous repairs and self-improvements
must carry baseline, candidate, rollout, and rollback evidence before they
change production behavior.

## Acceptance Evidence

- Diff showing the typed decision schema, writer, parser, and report
  integration.
- Focused test transcript for decision validation and report rendering.
- Sample artifact at `.kota/runs/<run-id>/autonomy-change-decision.json`
  showing a real or fixture-backed autonomy change with baseline and candidate
  evidence.
