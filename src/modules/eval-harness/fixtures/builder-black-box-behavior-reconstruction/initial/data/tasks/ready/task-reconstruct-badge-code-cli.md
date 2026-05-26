---
id: task-reconstruct-badge-code-cli
title: Reconstruct the badge-code CLI behavior from the oracle
status: ready
priority: p2
area: eval-harness
summary: Replace the candidate stub with a fresh implementation whose observable behavior matches the local reference oracle without depending on the oracle at runtime.
created_at: 2026-05-26T00:00:00.000Z
updated_at: 2026-05-26T00:00:00.000Z
---

## Problem

`src/badge-code.mjs` is a stub. The project includes docs and a reference
oracle, but not the source that generated the oracle's checksum behavior. The
candidate must match the reference CLI from observed behavior.

## Desired Outcome

Implement `src/badge-code.mjs` so it behaves like:

```sh
node oracle/run-reference.mjs <label>
```

Use `docs/behavior.md`, the oracle help output, and direct oracle observations
to reconstruct behavior. The scorer compares the candidate against the oracle
on fixed and deterministic generated cases:

```sh
node scripts/score.mjs --max-mismatches 0
```

Useful probes include one-character labels, repeated labels such as `aa` and
`aaa`, and labels that differ only by one character or separator. The checksum
is a small modular weighted checksum over the normalized label; the family is
derived from the checksum.

## Constraints

- Only change `src/badge-code.mjs` and this task's state.
- Do not edit `scripts/score.mjs`, `docs/behavior.md`, `oracle/`, package
  scaffolding, or fixture metadata.
- Do not copy the oracle artifact, import WebAssembly, shell out to the
  oracle, read oracle files, or make the final candidate depend on the oracle
  at runtime.
- Do not use network access, external services, large dependencies, or
  platform-specific assumptions.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `node scripts/score.mjs --max-mismatches 0` exits successfully.
- `node scripts/score.mjs --metric-only` prints `0`.
- The candidate handles help output, normalization, success output, and error
  output exactly like the oracle on the scorer's cases.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/score.mjs --max-mismatches 0`.
- The fixture run artifact records the `behavior_mismatches` objective metric.

## Source / Intent

Eval-harness fixture seed for measuring black-box behavior reconstruction.
The fixture exists because builder quality should include systematic behavior
discovery from executable observations, not only patching known source.

## Initiative

Outcome-grade autonomy evaluation: builder work should be judged by
deterministic behavior artifacts when the task is to reconstruct a small
program from documentation plus an executable oracle.
