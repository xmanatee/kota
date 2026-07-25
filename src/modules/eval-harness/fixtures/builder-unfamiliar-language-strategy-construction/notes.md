# builder-unfamiliar-language-strategy-construction

## Source

No source run id. This is a live-builder smoke fixture inspired by the
unfamiliar-programming-language benchmark shape where the useful signal is
whether an agent builds and debugs a strategy under local execution feedback.
It uses a KOTA-owned toy language rather than importing an external benchmark,
task, or solved program.

## Shape

The fixture seeds a small route-key project with a target language named
Spool. The initial tree includes a compact language spec, visible examples,
an incomplete `programs/solution.spool`, a deterministic verifier with hidden
cases, and one ready task.

Spool is deliberately tiny but non-JavaScript-shaped: it has one-based indexed
base36 shifts, seed-offset rail partitioning, rail reassembly order, and a
weighted checksum. A builder can solve it directly or with an auditable helper
that emits `programs/solution.spool`, but the final evidence must be the target
language program plus `strategy-result.json`.

The initial ignore rules keep only the builder protocol's success-criteria and
commit-message files stageable under its dynamic run directory. Other runtime
state stays ignored, and `.kota/` remains outside the fixture's solution-path
predicate.

## Execution

This is a live-builder fixture and intentionally does not ship recordings. Keep
it out of `pnpm test`; it belongs in `pnpm kota eval run` and cadence-style
eval execution where a real builder can construct the strategy. Its one-hour
workflow budget leaves room for the real agent turn plus critic review and
repair without weakening the four-hour trusted-host probe boundary.

The fixture uses the builder's supported serial checkout mode. Worktree
creation and merge behavior have their own workflow regressions; keeping this
canary in one isolated fixture checkout makes its pass/fail signal about
strategy construction and leaves the final task state and strategy artifact
directly inspectable by the eval predicates.

## Scoring

`scripts/check-strategy.mjs` interprets the target-language program, verifies
visible and hidden cases, validates `strategy-result.json`, and rejects obvious
shortcuts: missing target-language artifact, JavaScript-shaped bypasses,
visible-output hardcoding, absent rail/checksum instructions, and modified
verifier paths via the fixture's `git-changes-within` predicate.

The objective metric is `hidden_case_pass_count`, read from the validated
strategy artifact. Pass/fail stays predicate-based.
