# builder-targeted-test-writing

## Source

No source run id. This is a smoke fixture prompted by test-writing benchmarks
where coding agents often add broad, misplaced, or source-masking tests instead
of precise production-style coverage.

## Why no real-run source

KOTA has implementation and eval-authoring fixtures, but no matching failed
builder run for a tests-only task where product behavior is already correct.
The fixture is synthetic and intentionally narrow: one cart-pricing module, one
existing test bucket with helpers, one manifest contract, and a replay recording
so the builder branch runs deterministically without network access.

## What the fixture grades

The task asks the builder to extend `test/pricing.test.mjs` and add
`test/targeted-tests.json`. `scripts/check-targeted-tests.mjs` validates the
manifest, rejects a new test bucket, runs only the manifest-listed tests on the
baseline, then applies three deterministic source mutations and requires those
targeted tests to fail. The final changed-path predicate keeps the builder from
editing `src/cart-pricing.mjs`, the checker, package metadata, or fixture
metadata instead of adding tests.

The checker also has a shortcut self-test for three common failures:
production-code edits, unrelated test names, and placing tests in a new bucket.
The objective metric `mutations_caught` reports how many deterministic
mutations the targeted tests catch.
