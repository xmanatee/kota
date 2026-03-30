# Workflows

This directory contains built-in workflow definitions and their co-located prompts.

- Each workflow should live in its own subdirectory with code plus markdown prompt assets.
- Keep workflows cohesive and typed in code; keep long-lived guidance in markdown.
- Keep role boundaries sharp.

## Self-Trigger Loop Risk

Any workflow with a `workflow.completed` trigger **must** include a `workflow` filter that does not
contain its own name. Omitting the filter (or including the workflow's own name) causes the workflow
to re-trigger after its own completion, creating an infinite loop that hangs the runtime and the
test suite. The validation layer enforces this at definition load time as a hard error.

## Integration Test

`autonomous-loop.integration.test.ts` uses `getBuiltinWorkflowDefinitions()`, so every workflow
registered in `src/workflow/registry.ts` runs in that test. When adding a new built-in workflow:
- Ensure its trigger and step behavior is safe against the sparse test fixture in that file.
- Confirm the self-trigger loop guard above is satisfied.
