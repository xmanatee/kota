---
id: task-make-critic-and-evaluator-calibration-enforce-corr
title: Make critic and evaluator calibration enforce corrective action
status: done
priority: p1
area: autonomy
summary: Tighten the builder critic and evaluator-calibration loop so high pass-contradiction rates, pass-with-warnings debt, and weak evidence cannot remain notification-only signals.
created_at: 2026-04-29T12:52:55.387Z
updated_at: 2026-05-02T16:11:26.089Z
---

## Problem

Recent autonomous runs are productive, but the evaluator loop is accepting too
much quality debt as "pass". The repeated evaluator-calibration notifications
on 2026-04-29 reported critic pass contradiction rates around 60-62%, far
above the configured 25% threshold, while the action taken was mostly another
attention item.

The last-30 builder/evaluator artifacts show the same shape at the run level:

- 30 recent evaluator calibration artifacts had 25 total warnings.
- 4 of those 30 were `pass_with_warnings`; the rest mostly still passed with
  caveats.
- Critic warnings accepted weak evidence or incomplete literal satisfaction:
  text-only native "rendered" artifacts where screenshots would prove polish,
  compatibility shims such as `legacyEffect()`, broad strict-type baselines,
  placeholder/no-value tests, and textual guard tests that can be bypassed by
  renamed concepts.

That means the critic is useful but too permissive. It records concerns, yet
the workflow can still commit and move on without forcing repair, deferring a
follow-up, or marking the run as failed when the warning is load-bearing.

## Desired Outcome

The builder critic and evaluator-calibration workflows turn quality drift into
corrective action. A high pass-contradiction rate, repeated pass-with-warnings
pattern, or weak acceptance evidence must cause one of these outcomes:

- the critic blocks the current builder run with a critical issue;
- the repair loop fixes the issue before commit;
- a concrete follow-up task is created or promoted with the warning evidence;
- the evaluator-calibration workflow opens a repair task for critic/prompt/
  gate calibration instead of only notifying attention channels.

Passing should mean the task's outcome is genuinely proven by tests, runtime
probes, rendered artifacts, or explicit accepted trade-offs with tracked
follow-up work. "Pass, but remember this later" should stop being a terminal
state for systemic issues.

## Constraints

- Keep critic input artifact-only: diff, repo state, run artifacts, optional
  runtime probe. Do not feed thinking traces or self-reports into the critic.
- Do not add a parallel lessons store or audit surface. Use `.kota/runs/`, task
  files, scoped `AGENTS.md`, and existing evaluator-calibration artifacts.
- Do not make the critic fail every cosmetic caveat. Calibrate around
  load-bearing evidence gaps, contradiction drift, untracked compatibility debt,
  and warnings that recur across runs.
- Preserve builder throughput for clean tasks; stricter gates should target
  ambiguous passes, not add ceremony to obvious low-risk fixes.
- Keep cost/balance summaries operator-facing unless a workflow consumes a
  narrow deterministic signal; do not inject cost dashboards into agent prompts.

## Done When

- `evaluator-calibration-monitor` has a deterministic corrective path when
  pass-contradiction rate exceeds threshold: it either emits/creates a concrete
  calibration repair task or promotes an existing one, with run evidence named.
- Builder critic guidance or checks distinguish harmless caveats from blocking
  evidence gaps. Weak visual/runtime evidence, placeholder tests, untracked
  compatibility shims, and baseline-only strictness ratchets have explicit
  pass/fail/follow-up rules.
- A critic warning that is accepted as a trade-off must leave a durable trace:
  either a linked follow-up task, a task-body known-limitation accepted by the
  owner/task, or a specific non-action reason in the run artifact.
- Tests or fixtures cover at least these cases:
  - high pass-contradiction drift produces corrective action;
  - a weak rendered-evidence artifact causes critic failure for a client task
    that asked for visual proof;
  - a harmless localized warning can still pass without creating noise;
  - repeated pass-with-warnings on overlapping files/tasks is escalated.
- The next `kota report` or evaluator artifact makes the new action visible
  without requiring an operator to read every critic JSON file manually.

## Source / Intent

Owner asked on 2026-04-29 to re-check the last 30 commits and logs, identify
workflow shortcomings, and ensure tasks exist so KOTA workflows address every
execution-quality issue.

Runtime evidence from `.kota/runs/` on 2026-04-29:

- repeated `evaluator-calibration.regression.detected` events reported critic
  pass contradiction around 60-62%, above the 25% threshold;
- latest report window showed 194 tasks done in 7 days and high builder spend,
  so permissive passes compound quickly;
- recent critic reviews accepted several nontrivial warnings instead of
  forcing repair or concrete follow-up.

## Initiative

Autonomy execution quality: builder success should mean proven completion, not
only a clean commit with advisory caveats.

## Acceptance Evidence

- Test output for the evaluator-calibration escalation and critic warning
  classification fixtures.
- A run-directory artifact showing a formerly notification-only calibration
  drift now produces a repair task, promotion, or blocking critic verdict.
- Updated scoped autonomy guidance naming which critic warning classes must
  fail, track follow-up, or pass as harmless.
