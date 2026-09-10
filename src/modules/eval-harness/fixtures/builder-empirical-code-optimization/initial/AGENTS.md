# Empirical Code Fixture

This is a tiny eval fixture. Keep changes scoped to the task.

- Improve only `src/predictor.mjs`.
- Use `pnpm test` or `node scripts/score.mjs --max-holdout-mae 0.25` to verify the score.
- After verification, edit the assigned task's frontmatter to contain only
  `status: done` and move its Markdown file into `data/tasks/archive/`.
  Preserve the task body.
- Do not edit `package.json`, scripts, fixture data, or scorer files.
