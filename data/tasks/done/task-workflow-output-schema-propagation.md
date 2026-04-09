---
id: task-workflow-output-schema-propagation
title: Expose workflow outputSchema in definitions panel and validate trigger-step consumers
status: done
priority: p3
area: workflow-runtime
summary: Workflows can declare an outputSchema but the web UI does not surface it and the runtime does not validate that a trigger-step consumer's expected shape matches what the child workflow actually produces. Closing this gap catches mismatches early and makes contract-driven composition visible to operators.
created_at: 2026-04-02T02:37:15Z
updated_at: 2026-04-02T03:29:03Z
---

## Problem

`inputSchema` is now documented, validated at enqueue time, and surfaced in the web UI.
`outputSchema` was documented in the same pass but has no runtime enforcement and is
invisible in the UI. A workflow author publishing a child workflow with an `outputSchema`
has no way to verify that calling workflows handle the declared shape, and operators
browsing the definitions panel see no indication that a workflow produces structured
output.

Two concrete gaps:
1. The web UI definitions panel shows "Inputs: ..." when `inputSchema` is present but
   shows nothing for `outputSchema`.
2. The runtime does not compare a trigger step's expected output against the child
   workflow's `outputSchema` during validation; mismatches surface only at runtime when
   downstream steps read missing fields.

## Desired Outcome

- The web UI definitions panel shows an "Outputs: field: type, ..." line (analogous to
  the Inputs line) when a workflow declares a non-empty `outputSchema`.
- Workflow validation warns when a trigger step targets a workflow whose `outputSchema`
  conflicts with how the parent workflow uses `childOutput` (property access that cannot
  exist given the schema).
- No breaking changes to existing workflow definitions; `outputSchema` remains optional.

## Constraints

- UI change confined to `client-wf-definitions.ts`.
- Validation warning should not block run dispatch — emit a `WorkflowRunWarning` rather
  than a hard error.
- Do not require operators to annotate trigger steps; infer what can be inferred from the
  declared schemas and flag only clear contradictions.

## Done When

- A workflow with `outputSchema` shows an "Outputs:" line in the definitions panel.
- A workflow validation test covers the trigger-step schema mismatch warning path.
- Existing tests pass unchanged.
