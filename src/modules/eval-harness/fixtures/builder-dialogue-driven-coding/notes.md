# builder-dialogue-driven-coding

## Source

No source run id. This is a smoke fixture prompted by dialogue-driven coding
benchmarks where the user request is underspecified and the agent's
clarifying-question behavior is a separate capability from patch production.

## Why no real-run source

KOTA already has fixtures for builder patch quality, product requirements,
owner-question delivery, and replay plumbing, but no matching failed builder
run where the correct code change depends on an answer elicited during the
same task. The fixture is synthetic and intentionally small: one copy-formatting
module, one deterministic simulator script, one checker, and replay recordings
so the builder and critic branches run without network access.

## What the fixture grades

The seeded task asks for a stale Nova launch notification label but omits the
material channel requirement. The builder is expected to run
`scripts/user-simulator.mjs ask ...`, receive the SMS/text-message requirement,
implement `src/notification-copy.mjs`, and verify with
`scripts/check-dialogue.mjs`.

The checker validates that the simulator transcript is bounded, relevant, and
non-repeated; that the implementation reflects the elicited SMS answer instead
of a hardcoded Nova-only guess; and that `dialogue-result.json` records the
transcript, elicited facts, final decision, verification command, and
implementation evidence. A self-test covers no-ask patching, irrelevant or
repeated questioning, and answer-ignoring patches.
