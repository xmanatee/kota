# Targeted Test-Writing Fixture Project

This fixture is a tiny local cart-pricing project.

- Keep it dependency-free and use built-in Node.js APIs.
- After verification, edit the assigned task's frontmatter to contain only
  `status: done` and move its Markdown file into `data/tasks/archive/`.
  Preserve the task body.
- Add focused tests for existing behavior instead of changing product code.
- Extend the existing `test/pricing.test.mjs` bucket and its helper style.
- Do not edit `scripts/check-targeted-tests.mjs`; it is the fixture-owned scorer.
