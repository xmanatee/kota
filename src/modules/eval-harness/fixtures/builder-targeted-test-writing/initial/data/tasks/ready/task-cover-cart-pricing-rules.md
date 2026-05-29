---
id: task-cover-cart-pricing-rules
title: Cover cart pricing loyalty and delivery rules
status: ready
priority: p2
area: eval-harness
summary: Add precise tests for existing cart-pricing loyalty and delivery behavior without changing product code, runner scripts, or fixture metadata.
created_at: 2026-05-29T00:00:00.000Z
updated_at: 2026-05-29T00:00:00.000Z
---

## Problem

`src/cart-pricing.mjs` already implements the cart pricing rules correctly, but
the existing tests only cover a standard small cart. The under-tested behavior
is important because a future refactor could quietly move the loyalty threshold,
apply the gold discount to the wrong customer tier, or calculate free delivery
after discounts instead of from the pre-discount subtotal.

## Desired Outcome

Extend the existing `test/pricing.test.mjs` bucket with focused tests for the
current loyalty and delivery behavior. Add `test/targeted-tests.json` listing
the tests you added so the scorer can run only the targeted tests.

Use this verification command:

```sh
node scripts/check-targeted-tests.mjs
```

## Required Test Names

The manifest must list these exact tests in `test/pricing.test.mjs`:

- `applies the gold loyalty discount at the threshold subtotal`
- `does not give loyalty discount to silver customers`
- `keeps free delivery based on subtotal before discounts`

## Constraints

- Only edit `test/pricing.test.mjs`, add `test/targeted-tests.json`, and move
  this task to `done/`.
- Do not change `src/cart-pricing.mjs`, `scripts/check-targeted-tests.mjs`,
  `package.json`, fixture metadata, or runner scripts.
- Do not add dependencies, snapshots, generated golden-output dumps, broad
  unrelated tests, a new test bucket, network calls, or LLM judges.
- Use the existing helper style from `test/helpers/pricing-helpers.mjs`.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `node scripts/check-targeted-tests.mjs` exits successfully.
- `test/targeted-tests.json` lists exactly the targeted tests added.
- The targeted tests pass against the unmodified baseline behavior.
- The targeted tests fail against all deterministic mutations applied by the
  scorer.
- No product/source code, scorer, runner, package, or fixture metadata changes.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/check-targeted-tests.mjs`.
- `test/targeted-tests.json`.
- The fixture run artifact records the `mutations_caught` objective metric.

## Source / Intent

Eval-harness fixture seed for measuring tests-only builder quality. The builder
should add precise tests for correct existing behavior and prove relevance
through deterministic mutation checks, not hide behind product-code edits,
misplaced test buckets, or broad tests that do not catch regressions.

## Initiative

Outcome-grade autonomy evaluation: KOTA should grade whether builders can add
focused tests that protect existing behavior without changing implementation
code.
