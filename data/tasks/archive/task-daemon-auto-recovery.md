---
status: done
---

# Add auto-recovery mode to kota doctor for fixable issues

## Problem

`kota doctor` checks daemon connectivity, config validity, module health, provider availability, workflow definitions, and disk state. When it finds issues it prints a human-readable report but takes no corrective action. After a daemon crash or unexpected shutdown, operators must manually clean up stale lock files, verify the runtime directory, or re-initialize missing artifacts — steps that `doctor` already knows how to detect.

## Desired Outcome

`kota doctor --fix` applies safe automatic repairs for fixable issues discovered during the diagnostic run:

- Remove a stale `.kota/daemon-control.json` lock file when the daemon process is no longer alive.
- Re-create missing required directories (`.kota/`, `.kota/runs/`, task directories).
- Report which repairs were applied and which issues require manual action.

Non-destructive repairs only — `--fix` must not delete run artifacts, history, or operator data.

## Constraints

- `--fix` is opt-in; `kota doctor` without the flag remains read-only.
- Each repair must be idempotent and safe to run repeatedly.
- Repairs that could cause data loss (deleting run files, clearing history) are out of scope.
- The fix output should clearly distinguish "repaired", "skipped (already ok)", and "manual action required".
- Keep the implementation inside `src/doctor-cli.ts`; do not reach into daemon internals for repair logic.

## Done When

- `kota doctor --fix` runs all existing checks and applies available automatic repairs.
- Stale daemon lock file (process not alive) is removed by `--fix`.
- Missing standard directories are created by `--fix`.
- Output clearly indicates which items were repaired and which require manual intervention.
- `kota doctor` (no flag) remains read-only and unchanged in behavior.
- Unit or integration tests cover the repair paths.
