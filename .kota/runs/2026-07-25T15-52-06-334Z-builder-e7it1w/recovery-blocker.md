# Recovery blocker

The canonical recovery projection was captured successfully, but this builder
sandbox cannot mutate the canonical checkout or its linked Git metadata, and
the daemon control API is offline.

Observed failures:

- `kota task move task-reconcile-stale-recovery-state-blocking-existing-p doing`
  reached the repo-task mutation path, then rolled back when Git could not
  create the linked-worktree `index.lock`. The task was moved locally through
  the same domain operation using an isolated index/object database; the
  workflow finish command subsequently staged the exact move in the real
  worktree index.
- Dismissing `dlq-69c2533c-359d-47ba-91d3-74a3c45e4b1f` through
  `kota workflow dlq dismiss` fell back to offline mode and failed with
  `EPERM` while creating the canonical atomic-write temporary file.
- `kota status` reports the fresh control file at
  `http://127.0.0.1:64537`, but the daemon control API is unavailable.

No canonical recovery claim, worktree, dead letter, or runtime file changed.
The owned task remains open because its Done When and acceptance evidence are
not satisfied.

Disposition evidence:

- Builder-failure commit `467c730c2` is superseded by the broader landed
  provider-outage fix `0eb76a9f`; a trusted host must clear the interrupted
  merge before the canonical supersede-and-cleanup action can run.
- The security-review worktree has no unique commit. Landed commit
  `18a12e397` implements the compact-candidate outcome, but the staged worktree
  remains preserved until a trusted comparison confirms it contains no unique
  changes.
- The improver dead letter is an old provider incident. Commit `0eb76a9f`
  classifies that outage family, commit `5a2de0459` closed the repair, and 13
  later improver runs reached success. Dismissal is safer than replaying the
  stale fan-out completion, but the dismissal did not execute.
