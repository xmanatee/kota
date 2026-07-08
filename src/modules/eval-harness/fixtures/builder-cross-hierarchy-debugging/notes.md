# builder-cross-hierarchy-debugging

## Source

No source run id. This is a live-builder smoke fixture inspired by
hierarchy-aware debugging failures: the first visible failure is downstream,
but the durable fix belongs in an upstream selector.

## Shape

The seeded project has three layers:

- `src/gateway.mjs` renders the operator-visible dispatch envelope.
- `src/signal-flow.mjs` builds the normalized signal flow.
- `src/channel-registry.mjs` owns the hierarchy-to-channel lookup.

The initial bug is in `channel-registry.mjs`: it checks only the leaf and root
segments of a signal path, so pressure alarms fall through to the root
`ambient-monitor` rule. The failure first appears as a gateway dispatch topic
such as `queue/ambient-monitor` where the test expects `queue/safety-cutoff`.

## Scoring

`scripts/check-debug-trace.mjs` runs the real verification command
`node --test test/signal-flow.test.mjs`, validates `debug-trace-result.json`,
and rejects edits to the downstream symptom layer, flow adapter, verifier, and
test files. It also probes sibling holdout signal paths and rejects concrete
full-path literals in `src/channel-registry.mjs`, so exact-output lookup
tables do not satisfy the root-cause requirement. The artifact must name the
failing command, downstream symptom file, upstream root-cause file, causal
path, verification result, and a numeric `causalPathCoverage` metric.

The adversarial calibration case applies a tempting `src/channel-registry.mjs`
shortcut that maps the three visible test paths exactly plus a plausible trace
artifact. It passes the narrow test command but fails the verifier's sibling
holdout routes and concrete signal-path source guard.

## Execution

This is a live-builder fixture and intentionally does not ship recordings.
Keep it out of `pnpm test`; replay-backed fixtures cover the no-cost smoke
gate. Run it with `pnpm kota eval run --fixture builder-cross-hierarchy-debugging`.
