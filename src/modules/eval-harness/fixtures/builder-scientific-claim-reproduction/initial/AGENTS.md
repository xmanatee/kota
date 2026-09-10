# Scientific Claim Fixture

This is a tiny eval fixture. Keep changes scoped to the task.

- Complete only `scripts/analyze-claim.mjs`, then write the required claim result files.
- Use `pnpm test` or `node scripts/check-claim.mjs --max-error-pct 0.000001` to verify the evidence.
- After verification, edit the assigned task's frontmatter to contain only
  `status: done` and move its Markdown file into `data/tasks/archive/`.
  Preserve the task body.
- Do not edit `package.json`, scripts/check-claim.mjs, docs, fixture data, or fixture metadata.
