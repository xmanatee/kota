---
status: open
priority: p1
depends_on: [task-simplify-agent-loop-contract-tests]
---

# Remove provider-adapter copies of shared harness behavior

## Scope And Starting Points

Own tests in `src/modules/*agent-harness` and `src/modules/model-clients`.
Start with openai-tools (3,084 LOC), model-clients (3,555), Gemini, Codex,
Gemini CLI, AGY, Claude and Vercel adapter families. Existing shared-runner and
scenario-loop fixtures provide starting points; do not add another framework.

## Required Outcome

Keep provider-specific wire/CLI options, event parsing, authentication projection,
native isolation and capability differences. Remove reimplementations of the
predecessor's neutral loop/message/usage cases where they add no adapter-boundary
confidence. Separate SDK wire ports and native process ports; do not force them
through a fake universal provider model.

Preserve resume/persistence evidence from the separate session task if integrated;
do not race that implementation or change its semantics to reduce test count.
Avoid mandatory live quota-consuming calls for unchanged transport logic. Verify
changed boundary behavior with controlled ports and report actual live limitations.

## Acceptance

Use `task-verify-fifty-percent-test-reduction` rules, adapter-specific outcome
checks and a short explanation of shared versus provider-owned proof. Remove
orphan fixtures, report category deltas, and leave supported functionality intact.
