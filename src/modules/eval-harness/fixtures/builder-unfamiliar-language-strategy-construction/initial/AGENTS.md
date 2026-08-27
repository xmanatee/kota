# Unfamiliar Language Strategy Fixture

This is a tiny eval fixture. Keep changes scoped to the task.

- The assigned task stays `open` while the builder run is active.
- Learn the Spool target language from `docs/spool-language.md`,
  `docs/route-key.md`, visible examples, and local verifier feedback.
- Change `programs/solution.spool`, optionally add
  `scripts/generate-solution.mjs`, and write `strategy-result.json`.
- Do not edit `scripts/check-strategy.mjs`, docs, examples, package
  scaffolding, or fixture metadata.
- Use `node scripts/check-strategy.mjs --visible-only --no-strategy` for
  visible feedback and `node scripts/check-strategy.mjs` for final proof.
- Use `pnpm run finish-task` to move the task to `done`.
