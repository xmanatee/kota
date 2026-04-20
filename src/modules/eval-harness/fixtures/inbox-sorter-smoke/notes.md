# inbox-sorter-smoke

## Source

No source run id. This is a smoke fixture that exists to prove the
inbox-sorter workflow can run end-to-end under the harness: one
rough idea goes in, one normalized task comes out, the inbox drains.
It is intentionally orthogonal to the real-failure fixtures — the
dedup fixture next door tests a specific past-failure mode, while
this one tests that the baseline normalize-one-idea path is intact.

## Why no real-run source

Real-run sourcing is required for fixtures that encode a past failure
mode. A pure smoke fixture has no failure to encode; its purpose is
to fail loudly when harness plumbing regresses. If a specific
inbox-sorter failure mode would be covered better by removing this
smoke fixture in favor of a real-failure one, remove it rather than
carrying it as legacy.
