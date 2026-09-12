---
status: done
---
# Add a scientific-claim reproduction fixture to the eval harness

## Outcome

The shipped `builder-scientific-claim-reproduction` fixture reconstructs a
paper-like procedure from local data and grades claim/holdout artifacts plus
execution on verifier-only input. Its manifest declares the initial failure,
task archival, write scope and objective metric. The trusted scorer rejects
wrong procedures, prewritten answers, known-data hardcoding and malformed
provenance; analyzer execution remains fail-closed behind the existing isolation
owner.

Under the September 13 owner authorization, this task accepts implemented,
locally validated fixture/scorer behavior. A successful model solution is not
a prerequisite for shipping an evaluation fixture. No new benchmark task is
created: model-dependent qualification belongs to explicit eval selection or
the existing cadence, with its own actual results.

## Verification And Limits

On September 13, `pnpm kota eval list` loaded the fixture. All 11 tests in
`scientific-claim-artifact.test.ts`,
`scientific-claim-reproduction-fixture.test.ts` and
`scientific-claim-analyzer-sandbox.test.ts` passed. These exercise artifact
validation, real analyzer behavior and the process-port contract with the
existing test backend. They do not prove live container enforcement or model
quality.

No live nested builder or Docker execution ran in this audit. Earlier attempts
did not produce a completed live claim/holdout result; retained September 12
host inspections reported unset `KOTA_EVAL_CONTAINED_PROFILES`. Live execution
still needs an authorized container route, image, provider egress and adapter
authentication. Do not fall back to host candidate execution or call calibration
a benchmark pass.

## Intent And Provenance

Explorer introduced this synthetic scenario from the AutoMat research signal:
https://arxiv.org/abs/2605.00803. Its distinct purpose is procedure reconstruction
and honest support/refute interpretation, not materials-science tooling or an
imported benchmark. The fixture notes own the current model/prompt decision;
Git and retained run records preserve earlier attempts.
