---
status: done
---

# Make generated workflow recovery commands use a runnable CLI entrypoint

## Problem

KOTA now exposes workflow state-recovery for pending-merge task claims, but the
operator command currently advertised from claim-blocked queue payloads is not
reliably runnable in this checkout. `src/modules/autonomy/queue-availability.ts`
emits:

```
pnpm kota workflow state-recovery list
```

During explorer run `2026-07-08T06-23-37-319Z-explorer-k9xwqc`, that exact
command failed with `error: unknown command 'state-recovery'` because
`pnpm kota` uses the dist-backed `bin/kota.mjs` path and the current dist
surface does not expose the source-mode subcommand. The source-mode command
does work:

```
pnpm dev workflow state-recovery list --json
```

and correctly reports the pending-merge claim for
`task-run-shadow-semantic-reviewers-for-non-builder-auto` as blocked on real
merge evidence. That means the recovery feature exists, but the queue and
attention surfaces can still send operators to a dead command precisely when
the dispatchable queue is empty.

## Desired Outcome

Generated recovery instructions are executable from the operator context they
name. When KOTA surfaces `recoveryCommand` or `resolveCommand` for a
claim-blocked queue, the command should work through the advertised CLI entry
point or clearly choose the source-mode entry point when that is the active
checkout surface.

The fix should cover every visible place that reuses the generated command:
dispatcher queue payloads, attention digest output, dashboard/control
affordances, and any tests that pin the literal command strings.

## Constraints

- Do not weaken pending-merge claim safety. This task is only about command
  discoverability and executable instructions, not automatically releasing a
  claim whose worktree still has merge blockers.
- Do not add a second recovery command family. Keep using the existing
  `workflow state-recovery` operation and its daemon/local-client path.
- Avoid hardcoding one-off commands only for the current task id; the command
  generator should stay reusable for future claim-blocked queues.
- Preserve packaged `pnpm kota` behavior for built installs. Source-mode
  fallback or command selection must not hide a genuinely broken release build.

## Done When

- Claim-blocked queue payloads and attention/status output no longer advertise
  a command that fails as `unknown command 'state-recovery'` in the development
  checkout.
- Focused tests cover the command string produced for
  `recoveryCommand`/`resolveCommand` and at least one rendered operator surface
  that includes those commands.
- A CLI transcript under `.kota/runs/<run-id>/` shows the advertised command
  listing the pending-merge recovery state, or an equivalent fixture proves the
  selected entry point reaches `workflow state-recovery`.
- Existing workflow state-recovery safety tests still cover refusal when
  pending-merge evidence reports unresolved merge blockers.
- `pnpm run validate-tasks` passes after this task is present.

## Source / Intent

Explorer run `2026-07-08T06-23-37-319Z-explorer-k9xwqc` saw no dispatchable
work: the only ready task was claim-blocked by pending-merge builder run
`2026-07-07T06-33-49-256Z-builder-79nvwh`, the only non-anchor backlog task was
dependency-blocked, and every surfaced strategic blocked alternative required
operator-captured live evidence.

Local evidence gathered in this run:

- `pnpm kota workflow state-recovery list` failed with `unknown command
  'state-recovery'`.
- `pnpm dev workflow state-recovery list --json` succeeded and showed the same
  pending-merge claim with `recommendedAction.kind: "blocked"` because merge
  evidence still needs review.
- `pnpm run validate-tasks -- --min-ready 0` passed before this task was
  created.

Overlap check:

- `task-add-canonical-recovery-actions-for-stale-workflow-` already shipped the
  daemon/local recovery action.
- `task-make-queue-availability-claim-aware-for-pending-me` already prevents
  pending-merge tasks from counting as ordinary dispatchable work.
- `task-recover-shadow-review-branch-blocked-by-merge-gate` owns the specific
  blocked claim cleanup once operator/canonical merge evidence is available.

This task is the remaining nonduplicative operator-surface gap: KOTA should not
point a stalled queue at an unavailable command.

## Initiative

Reliable autonomy queue recovery and operator control.

## Product / Safety Link

Product/Safety execution stalls when the queue has only pending-merge-claimed
work and the operator recovery instructions are not executable. Making the
advertised recovery command runnable reduces manual state-edit pressure while
preserving merge-gate and claim-safety boundaries.

## Acceptance Evidence

- `.kota/runs/2026-07-08T07-22-16-062Z-builder-8lne6o/focused-test-transcript.txt`
  covers generated recovery commands, a rendered attention digest surface, a
  rendered dashboard surface, dispatcher/builder claim-aware behavior, and the
  existing pending-merge refusal safety path.
- `.kota/runs/2026-07-08T07-22-16-062Z-builder-8lne6o/cli-transcript.txt`
  shows the advertised `pnpm dev workflow state-recovery list --json` command
  reaches `workflow state-recovery` and reports pending-merge recovery state.
- `.kota/runs/2026-07-08T07-22-16-062Z-builder-8lne6o/validation.txt`
  records `pnpm run validate-tasks` after the task is moved to `done`.

## Completion Notes

Implemented source-vs-package command generation for workflow state-recovery
hints. Source-loaded checkouts now advertise `pnpm dev workflow
state-recovery ...`; dist-backed installs continue to advertise `pnpm kota
workflow state-recovery ...`. The `pnpm dev` script now uses the repo's
source-loader pattern so the advertised source-mode entrypoint runs without
the `tsx` CLI IPC path.
