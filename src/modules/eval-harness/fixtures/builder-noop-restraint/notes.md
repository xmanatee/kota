# builder-noop-restraint

## Source

No source run id. This is a smoke fixture that protects an eval-harness
invariant prompted by already-fixed task research: when the requested
production state is already true, the builder can complete honestly without
making a production patch.

## Why no real-run source

No matching KOTA run artifact was available for this exact failure shape. The
fixture is synthetic and narrow: one preexisting marker, one ready task, and a
changed-path predicate that allows task-state movement while rejecting any
production-file edit.

## Why this fixture captures it

The marker-content predicate proves the requested state remains present. The
task predicates prove the task closed. The `git-changes-within` predicate
compares the final fixture repo against its initial commit and allows only the
ready-to-done task move, so unnecessary edits under `data/markers/` fail.
