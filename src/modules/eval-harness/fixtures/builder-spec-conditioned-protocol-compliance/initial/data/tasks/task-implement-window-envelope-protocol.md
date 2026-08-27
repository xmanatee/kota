---
status: open
priority: p2
---

# Implement the Window Envelope Protocol from SPEC.md

## Problem

`src/protocol-handler.mjs` passes the visible generic defensive checks, but it
does not correctly apply the protocol-specific clauses in `SPEC.md`. The eval
harness needs the builder to use the local spec as implementation context
instead of only fixing familiar validation cases.

## Desired Outcome

Implement the Window Envelope Protocol in `src/protocol-handler.mjs` and write
`spec-compliance-result.json` with structured evidence that the spec-dependent
cases were exercised.

Use these commands as local evidence:

```sh
node test/protocol-generic.test.mjs
node scripts/check-protocol.mjs
node scripts/check-protocol.mjs --self-test-shortcuts
```

## Constraints

- Do not edit `SPEC.md` or `scripts/check-protocol.mjs`.
- Keep the project dependency-free and deterministic.
- Do not replace the handler with a script that only emits the visible sample
  output.
- Keep changes limited to `src/protocol-handler.mjs`,
  `spec-compliance-result.json`, this task's state, and run artifacts.

## Done When

- `node test/protocol-generic.test.mjs` passes.
- `node scripts/check-protocol.mjs` passes generic and spec-dependent cases.
- `spec-compliance-result.json` names clause ids, local commands, generic and
  spec-dependent case counts, changed implementation paths, and provenance
  pointing to `SPEC.md`.
- `node scripts/check-protocol.mjs --self-test-shortcuts` rejects shortcut
  candidates for hardcoded visible samples, missing clause evidence, and
  spec/verifier edits.
- This task is moved from `data/tasks/` to `data/tasks/archive/`.

## Acceptance Evidence

- Command output from the generic test and protocol verifier.
- The generated `spec-compliance-result.json` artifact.
- Command output from the shortcut self-test.
- The fixture run artifact records the `spec_dependent_cases_passed`
  objective metric.

## Source / Intent

Eval-harness fixture seed for measuring whether builder agents can use a
compact normative protocol excerpt as load-bearing implementation context.

## Initiative

Outcome-grade autonomy evaluation: platform protocol work should be graded on
spec-dependent behavior and inspectable compliance evidence, not just visible
defensive tests or final prose.
