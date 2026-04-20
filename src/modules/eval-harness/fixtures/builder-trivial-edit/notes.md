# builder-trivial-edit

## Source

No source run id. This is a smoke fixture that exists to prove the
fixture → workflow → predicate plumbing itself works end-to-end. It
exercises the minimum-viable builder path: one ready task, one file
edit, one task-state move. It is intentionally orthogonal to the
real-failure fixtures alongside it — a regression fixture proves the
agent still handles a specific past failure, while this fixture
proves the harness wiring is not itself broken.

## Why no real-run source

Real-run sourcing is required for fixtures that encode a past failure
mode. A pure smoke fixture has no failure to encode; its purpose is
to fail loudly when the harness, subprocess executor, or builder
workflow plumbing regresses. If a specific failure mode would be
covered better by removing this smoke fixture in favor of a
real-failure one, remove it rather than carrying it as legacy.
