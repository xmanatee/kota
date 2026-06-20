---
id: task-write-spool-route-strategy
title: Write the Spool route-key strategy
status: ready
priority: p2
area: eval-harness
summary: Learn the tiny Spool target language from local examples and verifier feedback, then produce a valid target-language route-key program plus machine-readable strategy evidence.
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## Problem

`programs/solution.spool` is an incomplete Spool program. Spool is a
fixture-owned target language with rail-based data layout and one-based
indexed shifts. The current program ignores rail reassembly and checksum
rules, so visible examples and hidden verifier cases fail.

The point is not to patch JavaScript. The outcome must be a Spool artifact
that runs through the local interpreter and a structured strategy artifact
showing how the solution was validated.

## Desired Outcome

Produce a correct Spool route-key program at:

```sh
programs/solution.spool
```

You may write a helper or generator at `scripts/generate-solution.mjs` if it
helps construct the target-language program, but the verifier grades the
emitted Spool program. Use the local docs and visible examples:

```sh
pnpm run examples
```

Then run the full deterministic verifier:

```sh
node scripts/check-strategy.mjs
```

Write `strategy-result.json` with:

- `helperCommand` as either the helper/generator command used or `null`;
- `programPath` set to `programs/solution.spool`;
- `validationCommands` listing the local commands you ran;
- `discoveredRules` with the machine-checkable Spool rules you used;
- `provenance` showing local feedback rather than visible-example hardcoding;
- visible and hidden case pass counts; and
- the final target-language instruction count.

## Constraints

- Keep the project dependency-free; use built-in Node.js only.
- Do not edit `scripts/check-strategy.mjs`, docs, examples, package
  scaffolding, or fixture metadata.
- Do not replace the solution with JavaScript, prose, a static output file, or
  a hardcoded list of visible example outputs.
- Keep changed paths to `programs/solution.spool`, optional
  `scripts/generate-solution.mjs`, `strategy-result.json`, and this task's
  state move.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `node scripts/check-strategy.mjs --visible-only --no-strategy` exits
  successfully.
- `node scripts/check-strategy.mjs` exits successfully.
- `strategy-result.json` is present and records every required strategy,
  provenance, discovered-rule, visible-case, hidden-case, and instruction-count
  field.
- `node scripts/check-strategy.mjs --self-test-shortcuts` exits successfully,
  proving the scorer rejects prose-only, JavaScript-shaped, and
  visible-example-hardcoded candidates.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/check-strategy.mjs --visible-only --no-strategy`.
- Command output from `node scripts/check-strategy.mjs`.
- The generated `strategy-result.json` artifact.
- Command output from `node scripts/check-strategy.mjs --self-test-shortcuts`.
- The fixture run artifact records the `hidden_case_pass_count` objective
  metric.

## Source / Intent

Eval-harness fixture seed for measuring unfamiliar-language strategy
construction. The fixture exists because builder quality should include
deriving and debugging a compact target-language strategy from local docs,
examples, interpreter feedback, hidden cases, and auditable helper artifacts
instead of only making familiar JavaScript patches.

## Initiative

Outcome-grade autonomy evaluation: builder quality should be judged by
deterministic strategy artifacts when the task requires adapting to unfamiliar
execution rules.
