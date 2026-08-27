# Scientific Claim Fixture

This is a tiny eval fixture. Keep changes scoped to the task.

- The assigned task stays `open` while the builder run is active.
- Complete only `scripts/analyze-claim.mjs`, then write the required claim result files.
- Use `pnpm test` or `node scripts/check-claim.mjs --max-error-pct 0.000001` to verify the evidence.
- Use `pnpm run finish-task` to move the task to `done`.
- Do not edit `package.json`, scripts/check-claim.mjs, docs, fixture data, or fixture metadata.
