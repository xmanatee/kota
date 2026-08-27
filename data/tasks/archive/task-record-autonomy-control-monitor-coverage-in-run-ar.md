---
status: done
---

# Record autonomy control-monitor coverage in run artifacts

## Problem

KOTA now has several independent controls for autonomous agent safety:
autonomy mode, tool-risk gating, the approval queue, injection-defense
screening, trajectory diagnostics, security-review workflows, and progress
review. Those controls are strong individually, but a completed workflow run
does not produce one bounded artifact that says which controls actually covered
the run.

That leaves an operator with a postmortem problem. If a builder, explorer,
critic, improver, or security-review run succeeds, the run artifacts show step
outputs and selected diagnostics, but they do not answer basic control
questions:

- how many agent steps and tool decisions were in scope for monitoring;
- which external or tool-derived payloads were screened by injection-defense;
- which write, network, approval, owner-question, or high-risk actions were
  blocked synchronously versus reviewed after the fact;
- whether post-run reviewers or trajectory diagnostics inspected the same run;
  and
- where the gaps were because a harness, step kind, or event source did not
  emit enough evidence.

This is risky as KOTA adds more harnesses, remote MCP tools, inbound channels,
and long-running autonomous workflows. A "green" run should remain a green
outcome, but the system also needs a compact control-coverage view so missing
monitoring is visible before it becomes a safety incident.

## Desired Outcome

Each autonomous workflow run writes a deterministic
`control-monitor-coverage.json` artifact under its run directory. The artifact
summarizes existing evidence; it does not add a new LLM judge or decide run
success.

At minimum, the artifact records:

- run identity: run id, workflow name, trigger event, head SHA, and schema
  version;
- monitored surface counts: agent steps, tool calls, external payload ingests,
  approval requests, owner-question waits, runtime probes, and post-run review
  checks visible from existing run artifacts and event records;
- synchronous controls: tool-policy decisions, autonomy-mode enforcement,
  approval gating, daemon-host-control guard denials, injection-defense blocks,
  and other before-action controls that prevented or paused an action;
- asynchronous controls: trajectory diagnostics, security-review scans,
  progress-review findings, workflow-failure escalation, and other after-action
  reviewers that inspected the run or its emitted evidence;
- coverage gaps: unsupported harness streams, missing agent-step event files,
  dynamic external payloads without injection-screening evidence, reviewers
  skipped for absent prerequisites, or any tool/control event that cannot be
  attributed to a known step; and
- compact metrics: coverage denominator/numerator per control family,
  blocked/warned counts, and a bounded time-to-response value when an
  asynchronous finding or escalation links back to the run.

The normal run status, task result, and repair-loop checks remain authoritative.
The coverage artifact is operator evidence: it tells KOTA and the owner how much
of the autonomous run was actually monitored and where follow-up tasks should be
opened when coverage is incomplete.

## Constraints

- Derive the artifact from existing typed run metadata, step outputs,
  `steps/<step-id>.events.jsonl`, tool telemetry, injection-defense results,
  approval/owner-question events, trajectory diagnostic artifacts, and
  reviewer outputs. Do not scrape raw terminal transcripts when structured
  artifacts exist.
- Keep the implementation inside the autonomy/workflow runtime ownership
  boundary unless an existing artifact type needs a narrow exported reader from
  its owning module.
- Do not add a parallel security scanner, benchmark, external monitoring
  service, model-as-judge control loop, or second event store.
- Keep records bounded and sanitized. Do not copy raw prompts, full tool
  outputs, secrets, untrusted payload bodies, cost figures, or large diffs into
  the coverage summary. Artifact paths, event ids, counts, control names, and
  concise reason codes are enough.
- Treat missing evidence honestly as `missing` or `unsupported`; do not infer
  coverage from a successful final status.
- Do not expose the coverage summary back into autonomous agent prompts.
  Operator reports and repair-task creation may consume it; agent context
  should not optimize around the monitor.
- Preserve existing repair-loop, approval, injection-defense, trajectory
  diagnostic, security-review, and progress-review behavior. This task records
  coverage; it must not weaken or bypass the controls it observes.

## Done When

- Autonomous workflow runs write
  `.kota/runs/<run-id>/control-monitor-coverage.json` with a stable schema,
  schema version, compact summary, control-family coverage entries, and
  explicit gap entries.
- The coverage builder can consume a fixture run directory with mixed evidence:
  at least one agent step, one tool decision, one injection-screened external
  payload, one approval or owner-question event, one trajectory diagnostic
  artifact, and one asynchronous reviewer/finding link.
- Missing evidence cases are represented deterministically, including a
  non-streaming harness or absent step event file and an external payload with
  no injection-screening artifact.
- Operator-facing status surfaces that already summarize run artifacts expose
  the coverage artifact path and gap counts without adding a new command.
- A focused repair/escalation path opens or seeds a normal task when repeated
  coverage gaps recur across recent autonomous runs, reusing existing
  trajectory/workflow-failure escalation patterns rather than creating a
  separate lessons store.
- Focused tests cover a fully covered run, missing agent-step stream evidence,
  unscreened external payload evidence, synchronous approval/tool guard
  coverage, asynchronous reviewer linkage with time-to-response, and bounded
  redaction of sensitive/raw content.
- Existing autonomy workflow tests, injection-defense tests, approval/owner
  question tests, trajectory diagnostic tests, and task validation remain green.

## Source / Intent

Explorer run `2026-06-22T09-19-59-358Z-explorer-jcxody` saw a strategic
ready-coverage gap: one actionable ready task existed, but it was a `p3` core
cleanup, with no backlog and the strategic blocked alternatives still gated on
operator-captured evidence.

Blocked alternatives considered:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` still requires the
  `.kota/runs/scientific-claim-reproduction-live-pass/` live eval capture.
- `task-add-an-unfamiliar-language-strategy-construction-f` still requires the
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/` live eval
  capture.
- `task-add-cross-preset-runtime-parity-gate` still requires the
  `.kota/runs/preset-parity-all-keys-set/` operator transcript pair with real
  provider auth.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` still requires the
  all-registered-harness `.kota/runs/harness-parity-*` capture.

External source checked:

- `https://deepmind.google/blog/securing-the-future-of-ai-agents/`, published
  June 18, 2026, describes Google DeepMind's AI Control Roadmap for internal
  agents. The relevant KOTA signal is system-level, defense-in-depth monitoring
  for imperfectly aligned agents: treat capable internal agents as potential
  insider threats, use trusted supervisors to review reasoning/actions/plans,
  block high-risk behavior synchronously when needed, and measure coverage,
  recall, and time-to-response instead of trusting alignment or final outcomes
  alone.

Local overlap check:

- `task-write-trajectory-quality-diagnostics-for-workflow-` writes
  deterministic process-quality diagnostics for agent-step trajectories, but it
  does not summarize whether approval, injection-screening, tool guard, and
  asynchronous reviewer controls covered the run.
- `task-screen-remote-mcp-tool-results-through-injection-d` and
  `task-add-injection-defense-on-web-derived-content-for-autonomous-mode`
  harden specific untrusted-content boundaries, but they do not produce a
  run-level coverage artifact for all payloads and steps.
- `task-prove-inbound-workflow-notifications-cannot-resolv` and
  `task-add-a2a-push-notification-configuration-support` prove specific
  inbound notification paths cannot resolve approvals or owner prompts, but
  they do not make per-run control coverage observable.
- `task-escalate-persistent-workflow-failure-patterns-into` and
  `task-escalate-recurring-trajectory-diagnostic-patterns-` open repair tasks
  from repeated failures or trajectory warnings; this task supplies the missing
  coverage-gap evidence that those mechanisms can reuse.
- `task-report-per-component-eval-attribution-for-score-mo` attributes eval
  score movement, not autonomous runtime control coverage.

The nonduplicative gap is a first-party control-coverage artifact for normal
autonomous workflow runs, derived from KOTA's existing typed evidence.

## Initiative

Trustworthy autonomous operation: KOTA should be able to show which controls
covered each autonomous run, where evidence was missing, and how quickly
after-action reviewers responded, without adding a parallel monitoring product
or trusting final agent prose.

## Acceptance Evidence

- Sample `.kota/runs/<run-id>/control-monitor-coverage.json` for a fixture or
  test run showing covered synchronous controls, asynchronous controls, and at
  least one explicit gap.
- Focused test transcript for the coverage builder and integration point, for
  example `pnpm test src/modules/autonomy/control-monitor-coverage.test.ts
  src/core/workflow/run-executor.test.ts`.
- Focused transcript showing existing control producers still pass, such as
  injection-defense, approval/owner-question, and trajectory diagnostic tests.
- Task validation transcript: `pnpm run validate-tasks`.
- Diff review showing the coverage artifact stores bounded reason codes,
  counts, event/artifact paths, and no raw prompts, secrets, payload bodies, or
  full tool outputs.

## Completion Evidence

- Added `control-monitor-coverage.json` generation from workflow run metadata,
  step events, tool telemetry, trajectory diagnostics, runtime probes, and
  linked reviewer artifacts.
- Added operator report aggregation/rendering for coverage artifact counts,
  gap counts, top gap families, recent artifact paths, and async reviewer
  response timing without adding a new command.
- Added autonomy health audit escalation for repeated coverage gaps through
  normal `task-health-*` repair tasks.
- Focused coverage/report/escalation tests passed:
  `pnpm exec vitest run src/modules/autonomy/report/control-coverage-report.test.ts src/modules/autonomy/report/report-cli.test.ts src/modules/autonomy/report/render-control-coverage.test.ts src/core/tools/tool-telemetry-mcp-provenance.test.ts src/modules/claude-agent-harness/executor.test.ts`
- Existing control producer and strict-types tests passed:
  `pnpm exec vitest run src/modules/injection-defense/defense-middleware.test.ts src/modules/injection-defense/defense-middleware-mcp-provenance.test.ts src/core/workflow/steps/approval-step.test.ts src/core/workflow/owner-decision-step.test.ts src/core/workflow/ask-owner-step.test.ts src/core/workflow/steps/step-executor-agent-trajectory-diagnostics.test.ts src/modules/autonomy/trajectory-diagnostic-escalation.test.ts src/strict-types-policy.integration.test.ts`
- Typecheck passed: `pnpm exec tsc --noEmit --pretty false`.
