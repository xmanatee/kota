# builder-trivial-edit

## Source

No source run id. This is a smoke fixture that exists to prove the
fixture → workflow → predicate plumbing itself works end-to-end. It
exercises the minimum-viable builder path: one ready task, one file
edit, one task-state move. It is intentionally orthogonal to the
real-failure fixtures alongside it — a regression fixture proves the
agent still handles a specific past failure, while this fixture
proves the harness wiring is not itself broken.

The fixture includes a minimal `package.json` so the builder's normal
repair checks are no-ops and `pnpm kota task move ...` resolves to the
host KOTA CLI through `$KOTA_DIST_DIR`, matching the other builder
fixtures. The scored task remains limited to the marker file and task
state move.
Tracked placeholder files keep the `doing/`, `done/`, and `blocked/`
directories present so `git mv`-backed task moves can create the target
task path inside the isolated repository.

## Why no real-run source

Real-run sourcing is required for fixtures that encode a past failure
mode. A pure smoke fixture has no failure to encode; its purpose is
to fail loudly when the harness, subprocess executor, or builder
workflow plumbing regresses. If a specific failure mode would be
covered better by removing this smoke fixture in favor of a
real-failure one, remove it rather than carrying it as legacy.
