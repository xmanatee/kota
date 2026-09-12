---
status: done
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

## Completion

Removed manual registry/text-completion copies and repeated hosted workflow prompt
journeys; core registry/module lifecycle and the retained OpenAI Tools workflow/critic
journey own the shared proof. Consolidated OpenAI translation cases at their wire
owner while preserving mixed ordering, thinking omission, finish reasons and parsed
tool arguments. Provider-specific options, native isolation, authentication, usage
and integrated session-recovery tests remain intact. Inline orphan helpers retired
with their suites; shared support and production code are unchanged.

Frozen-recipe candidate test LOC: 15,102 -> 13,907 (-1,195). Family deltas:
OpenAI Tools -154; model-clients -374; Gemini -245; Vercel -245; Codex -103;
Thin -74. AGY, Gemini CLI and Claude unchanged. Authored support remains 1,129
LOC; changed production and generated/vendor exclusions: zero. These are local
counts, not the parent task's published aggregate.

`pnpm check:fast` passed. Final focused verification passed 422 tests in 33 files,
including edited cases, adapter translation, shared guards/registry/module loading,
cross-process continuity and the retained workflow/critic journey. Wider selections
passed 506 tests and failed 40; baseline execution reproduced all 40 failures
(existing tool-binding fixtures, protected default session paths, and stale native
expectations), with no candidate-only failures. No live provider calls ran.
Run `2026-09-12T14-17-44-749Z-builder-ev5nlw` retains the logs, family deltas and
shared-versus-provider proof rationale in its ordinary agent summary.
