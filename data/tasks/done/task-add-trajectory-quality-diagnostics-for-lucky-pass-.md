---
id: task-add-trajectory-quality-diagnostics-for-lucky-pass-
title: Add trajectory-quality diagnostics for lucky-pass coding-agent runs
status: done
priority: p2
area: modules
summary: Use existing structured trajectory artifacts to flag passing coding-agent runs with process-quality warnings such as missing verification, blind retries, and disordered explore/implement/verify phases without replacing outcome predicates.
created_at: 2026-05-26T02:59:40.593Z
updated_at: 2026-05-26T03:24:19.000Z
---

## Problem

KOTA now records structured action/observation trajectories for harness-parity
runs, but those artifacts are still mostly descriptive. A run can pass its
final verifier after a noisy process - repeated blind retries, missing
post-edit verification, or exploration/implementation/verification steps in a
disordered sequence - and KOTA will report the same outcome status as a clean
trajectory.

That leaves a process-quality blind spot. The existing eval and harness-parity
surfaces answer "did the final artifact pass?" but do not help operators spot
"lucky pass" shapes where a pass is less trustworthy or more expensive than the
headline result implies.

## Desired Outcome

Harness-parity artifacts include deterministic trajectory-quality diagnostics
derived from existing structured trajectory frames.

The diagnostics should flag process warnings such as:

- no verification-like command after a file-editing action;
- repeated identical failing commands without an intervening code or config
  change;
- successful verification followed by further code edits without a final
  verification;
- large stretches of tool activity that never touch task-relevant files before
  the first implementation action;
- unsupported or missing trajectory frames when a harness claims native message
  streaming.

The output should be visible in per-run artifacts and the top-level parity
summary, with enough detail for an operator or future eval fixture to inspect
the exact frames that triggered each warning.

## Constraints

- Reuse the existing `trajectory.json`, `trajectory-summary.md`, and
  `KotaAgentMessage` protocol. Do not scrape text traces or introduce a
  provider-specific trajectory schema.
- Keep the first slice deterministic and local. Do not add an LLM judge, import
  AgentLens-Bench, or build Prefix Tree Acceptor reference models.
- Diagnostics are advisory by default. Do not replace scenario verification,
  eval-harness predicates, `pass^k`, or critic verdicts with process-quality
  scores.
- Allow scenarios to opt into failing on specific diagnostics only if the
  behavior is encoded as an explicit verifier/predicate contract.
- Keep cost/spend fields out of agent-facing prompts and trajectory replay
  inputs.
- Preserve honest unsupported-trajectory artifacts for harnesses that cannot
  emit KOTA-native message frames.

## Done When

- Harness-parity writes a stable trajectory-diagnostics artifact beside each
  per-stage `trajectory.json`.
- The top-level `parity.json` and human summary expose compact diagnostic
  counts and links/paths to the detailed diagnostic artifact.
- Focused tests cover at least these cases: clean edit-then-verify trajectory,
  missing final verification after edit, repeated identical failing command,
  edit after passing verification, and claimed streaming support with no
  emitted frames.
- Existing harness-parity scenarios keep their current pass/fail behavior
  unless a scenario explicitly opts into a diagnostic gate.
- The local `src/modules/harness-parity/AGENTS.md` guidance stays aligned with
  the new artifact at the conventions level.

## Source / Intent

Explorer run `2026-05-26T02-57-25-538Z-explorer-ksdw1c` reviewed a thin queue
with one actionable `p3` security task and a strategic ready-coverage gap. The
strategic blocked alternatives were considered, but all still require operator
captured evidence and are not movable:

- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External signal: AgentLens, submitted to arXiv on May 13, 2026, argues that
binary final-patch pass/fail misses process quality in SWE-agent runs. Its
abstract reports a 1,815-trajectory subset with 10.7% of passing trajectories
showing "lucky pass" behavior such as regression cycles, blind retries, missing
verification, or disordered exploration/implementation/verification.

KOTA overlap check:

- `task-record-structured-action-trajectories-in-harness-p` already added
  structured harness-parity trajectory artifacts.
- Existing eval-harness work covers `pass^k`, objective metrics, no-op
  restraint, scope-expansion restraint, and live critic calibration.
- No open task uses the structured trajectory artifacts to surface deterministic
  process-quality warnings for passing coding-agent runs.

The nonduplicative gap is therefore not a new benchmark or another evaluator
agent. It is a deterministic diagnostic layer over KOTA's existing trajectory
evidence.

Research link:

- https://arxiv.org/abs/2605.12925

## Initiative

Outcome-grade autonomy evaluation: a passing coding-agent result should remain
inspectable for process quality so operators can distinguish clean passes from
lucky, wasteful, or under-verified passes without abandoning KOTA's existing
artifact and predicate model.

## Acceptance Evidence

- Focused test transcript:
  `.kota/runs/2026-05-26T03-12-39-003Z-builder-i4o0g1/test-transcript.txt`
  (`pnpm test src/modules/harness-parity/trajectory-diagnostics.test.ts
  src/modules/harness-parity/runner.test.ts`).
- Sample diagnostic artifacts:
  `.kota/runs/2026-05-26T03-12-39-003Z-builder-i4o0g1/trajectory-diagnostics-samples/clean-trajectory-diagnostics.json`,
  `.kota/runs/2026-05-26T03-12-39-003Z-builder-i4o0g1/trajectory-diagnostics-samples/missing-final-verification-diagnostics.json`,
  and
  `.kota/runs/2026-05-26T03-12-39-003Z-builder-i4o0g1/trajectory-diagnostics-samples/repeated-failing-command-diagnostics.json`.
- Runner integration assertions in `src/modules/harness-parity/runner.test.ts`
  cover `parity.json` diagnostic counts and artifact paths.
