---
status: dropped
---

# Verify the cited Apple builder recovery lineage

## Problem

The builder repair for incomplete preserved evidence has focused fixture proof,
but its leased worktree cannot read the canonical runtime store that owns the
cited Apple-client claim. The exact run at
`.kota/runs/2026-08-23T17-26-21-807Z-builder-8knpd4/metadata.json` therefore has
no post-fix live observation. A fixture using the same ids is not a disposition
of that production claim.

## Desired Outcome

After the phase-separation change is loaded by the canonical runtime, observe or
redrive the exact preserved Apple-client recovery lineage. Record a typed
projection showing that `prepare-worktree` no longer fails with builder-evidence
ENOENT and that the preserved claim reaches completion or an explicit terminal
state-recovery disposition.

## Constraints

- Preserve the original task, failed-run, worktree-run, and claim provenance;
  do not substitute a synthetic lineage or infer unread metadata.
- Inspect and mutate recovery state only through the canonical trusted-host
  workflow/state-recovery surfaces. Do not bypass daemon ownership or read
  protected control and secret files.
- Do not declare the Apple Product task complete without its own screenshot,
  Swift trace, and parity evidence.

## Done When

- A canonical runtime artifact binds the failed continuation run
  `2026-08-23T17-26-21-807Z-builder-8knpd4` to the original preserved worktree
  run and a post-fix recovery attempt.
- The artifact shows `prepare-worktree` did not terminate with evidence-filesystem
  ENOENT and records the subsequent builder outcome.
- The preserved claim reaches completion or a typed terminal state-recovery
  disposition, with the Apple task and claim state left aligned.

## Source / Intent

Follow-up disposition from
`task-allow-builder-recovery-to-resume-incomplete-preser`. Its critic accepted
the phase-separation implementation but rejected the synthetic projection
because the canonical parent runtime store is outside the leased builder
worktree. The cited Apple Product task remains
`task-render-shared-ui-surfaces-in-apple-clients` in `ready/` until its own work
and operator evidence are complete.

Evidence:

- `.kota/runs/2026-08-23T17-26-21-807Z-builder-8knpd4/metadata.json`
- `.kota/runs/2026-08-24T12-19-13-793Z-builder-lf7znh/evidence/artifacts/recovery-projection.json`

## Product / Safety Link

Closes the remaining live-runtime verification gap blocking trustworthy recovery
of the P1 Product task `task-render-shared-ui-surfaces-in-apple-clients`.

## Initiative

Builder preserved-work recovery that is both resumable and auditable.

## Acceptance Evidence

- A projected JSON recovery artifact from the canonical runtime cites the exact
  failed run, original worktree run, post-fix attempt, `prepare-worktree`
  outcome, claim disposition, and resulting Apple task state. The corresponding
  `workflow state-recovery list --json` or resolve artifact must corroborate any
  non-completion disposition.
