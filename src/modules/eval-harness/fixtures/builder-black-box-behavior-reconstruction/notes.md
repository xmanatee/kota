# builder-black-box-behavior-reconstruction

## Source

No source run id. This is a live-builder smoke fixture inspired by
ProgramBench's black-box reconstruction shape: the agent receives executable
behavior plus documentation and must build a fresh compatible program from
observations, not from hidden source or a known patch target.

## Shape

The fixture seeds a tiny `badge-code` CLI project. `docs/behavior.md` documents
the interface and normalization rules, `oracle/run-reference.mjs` exposes the
reference behavior, and `src/badge-code.mjs` starts as a stub that fails the
scorer. The oracle's hidden checksum primitive is a minimal WebAssembly module
stored as base64 under `initial/oracle/reference.wasm.base64`.

The WebAssembly generation source lives outside `initial/` at
`oracle-src/build-reference-wasm.mjs`. Regenerate the oracle artifact with:

```sh
node src/modules/eval-harness/fixtures/builder-black-box-behavior-reconstruction/oracle-src/build-reference-wasm.mjs
```

Eval runs expose only the oracle wrapper and encoded artifact, not the
generation source that defines the checksum constants.

## Execution

This is a live-builder fixture. It intentionally does not ship `recordings/`,
so normal `pnpm kota eval run` and cadence execution call the builder rather
than the eval-harness replay adapter. Keep it out of `pnpm test`; replay-backed
fixtures cover the standard no-cost smoke gate.

## Scoring

`scripts/score.mjs` compares the candidate CLI against the oracle on fixed
examples and deterministic generated cases. It reports mismatch count as the
`behavior_mismatches` objective metric while keeping pass/fail predicate-based.
The scorer also rejects obvious shortcuts: candidate source may not reference
the oracle, copy the encoded artifact, include WebAssembly artifacts, or use
process-spawning/file-reading APIs to delegate behavior at runtime.

This stays out of `pnpm test`; the fixture is intended for `pnpm kota eval run`
and cadence-style evaluation, where the scorer and objective metric remain the
pass/fail evidence.
