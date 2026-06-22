---
id: task-apply-evidence-retention-policy-to-run-evidence-co
title: Apply evidence retention policy to run evidence consumers
status: done
priority: p2
area: architecture
summary: Teach workflow review, reporting, and replay consumers to treat pruned evidence as typed metadata references instead of missing evidence, closing the retention-consumer gap without adding a second evidence store.
created_at: 2026-06-22T19:26:49.976Z
updated_at: 2026-06-22T19:50:51.000Z
task_class: Platform
---

## Problem

KOTA now has a typed evidence policy for retention, redaction, provenance, and
pruned-reference behavior. Workflow run pruning, event-journal retention, dead
letters, approvals, setup requirements, and module capabilities already expose
pieces of that policy, but the consumers that review and replay autonomous run
evidence still mostly treat an unavailable artifact as "missing" rather than as
a typed pruned reference.

That creates a retention-consumer gap. Once old run directories, event payloads,
or sensitive artifact bodies age out, progress review, autonomy health review,
workflow-ops replay, operator reports, and evidence-id validation need to keep
the difference between:

- evidence that never existed;
- evidence that existed but is no longer retained by policy;
- evidence that is retained only as metadata/provenance; and
- evidence that is unavailable because a producer failed.

Without that distinction, retention can erase useful operator context, trigger
false repair tasks, or let a real missing-evidence regression hide behind a
generic "not found" path.

## Desired Outcome

Workflow review, reporting, replay, and validation consumers handle pruned
evidence through the existing typed evidence policy. When an artifact or event
payload has expired, consumers keep the retained metadata reference visible and
bounded instead of scraping deleted payloads, silently dropping the reference, or
classifying it as an ordinary producer failure.

At minimum:

- progress-reviewer evidence selection records retained metadata references and
  explicit exclusions for policy-pruned payloads;
- autonomy health/control-coverage reports distinguish policy-pruned evidence
  from producer-missing evidence in their gap summaries;
- workflow-ops replay or dry-run inspection can surface pruned event/run
  references without requiring the original payload body;
- evidence-id validation accepts typed pruned references only when their
  retained id, timestamps, state, scope, and provenance match the evidence
  policy; and
- operator-facing summaries use compact reason codes rather than raw retained
  payloads.

## Constraints

- Reuse `src/core/evidence/` policy types and the existing run/event stores.
  Do not add a second evidence ledger, task audit file, or progress-review
  storage surface.
- Treat pruned payload bodies as unavailable by design. Do not restore old
  behavior by copying prompts, tool outputs, event payloads, secrets, or large
  diffs into replacement summaries.
- Keep retention decisions deterministic and policy-driven. Consumers should
  not infer that a missing file was policy-pruned unless the retained metadata
  says so.
- Preserve existing producer failure visibility. A missing artifact that should
  still exist must remain a gap or error, not be downgraded to retention churn.
- Keep exact event and artifact schema handling in source and focused tests, not
  in durable docs catalogs.

## Done When

- Progress-reviewer and autonomy-health/control-coverage evidence packets can
  represent at least one policy-pruned run artifact and one policy-pruned event
  payload as metadata-only references with explicit reason codes.
- Evidence-id validation and reviewer citation checks accept those references
  when the retained metadata matches, and reject spoofed or malformed pruned
  references.
- Workflow-ops replay or dry-run inspection reports policy-pruned refs as
  pruned/unavailable while preserving scope, event id or artifact id,
  timestamps, state, and provenance.
- Operator reports distinguish producer-missing evidence from policy-pruned
  evidence so repeated real gaps can still escalate normally.
- Focused tests cover retained-reference success, spoofed-reference rejection,
  expired-payload exclusion, and still-missing producer evidence.
- Existing progress-reviewer, workflow-ops replay, event-journal, and task
  validation tests remain green.

## Source / Intent

Explorer run `2026-06-22T18-58-36-372Z-explorer-mz8mla` saw a strategic ready
coverage gap: one actionable ready task existed, but it was p3 maintenance,
with no backlog reserve and the strategic blocked alternatives still gated on
operator-captured live artifacts.

Blocked strategic alternatives considered but not chosen:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` remains blocked on
  `.kota/runs/scientific-claim-reproduction-live-pass/`, which requires an
  operator-captured live eval pass in an environment with nested model-provider
  access.
- `task-add-an-unfamiliar-language-strategy-construction-f` remains blocked on
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/`, which
  requires an operator-captured live eval pass with active nested Codex auth.
- `task-add-cross-preset-runtime-parity-gate` remains blocked on
  `.kota/runs/preset-parity-all-keys-set/`, which requires operator transcripts
  from a host with all required harness auth configured.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` remains blocked on
  an all-registered-harness `.kota/runs/harness-parity-*` capture.

Local evidence:

- `docs/ARCHITECTURE.md` names retention policy consumers as one of the current
  follow-up gaps for multi-scope continuous improvement.
- `src/core/evidence/policy-model.ts` already defines retained metadata,
  expired-payload behavior, and
  `prunedReferenceBehavior: "retain-id-timestamps-status-and-provenance"`.
- Completed task `task-add-retention-redaction-and-provenance-policy` added the
  policy model, while completed run-directory pruning and durable event-journal
  work made payload expiry real. The nonduplicative gap is teaching review,
  replay, and report consumers to honor the retained-reference state.
- Completed task `task-backfill-progress-reviewer-windows-from-durable-ev`
  backfills durable journal evidence, but it does not close the consumer
  behavior for policy-pruned payloads after retention expiry.

## Initiative

Retention-aware autonomy evidence: KOTA should be able to prune sensitive or
old payload bodies while preserving enough typed provenance for operators,
reviewers, and replay tooling to understand what happened and why evidence is
unavailable.

## Acceptance Evidence

- Focused progress-reviewer or autonomy-report test output showing
  metadata-only pruned references in the evidence packet and operator summary.
- Focused workflow-ops replay or dry-run test output showing a policy-pruned
  event/run reference is reported as pruned rather than missing.
- Evidence-id validation tests showing matching retained metadata is accepted
  and spoofed/malformed pruned references are rejected.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run validate-tasks` pass.

## Completion Evidence

- Added typed pruned-reference validation in `src/core/evidence/` plus event
  journal and pruned workflow-run readers.
- Progress-review evidence collection now surfaces policy-pruned run and event
  metadata references with `policy-pruned-payload` reason codes; reviewer
  citation validation rejects spoofed retained ids.
- Runtime health audit control-coverage output now distinguishes
  `policy-pruned-payload` from `producer-missing` evidence gaps.
- Workflow simulation journal replay reports policy-pruned journal references as
  unavailable metadata-only inputs without replaying payload bodies.
- Focused tests passed:
  `pnpm test src/core/events/event-journal.test.ts src/modules/autonomy/workflows/progress-reviewer/progress-review/event-evidence-journal-backfill.test.ts src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.test.ts src/modules/workflow-ops/simulation/engine.test.ts`.
- `pnpm run typecheck` passed.
- `pnpm run lint` initially reported import-order fixes only; Biome safe fixes
  were applied and lint was rerun successfully.
- `pnpm run validate-tasks` passed after staging the task move.
