---
status: open
priority: p2
---
# Render workflow details directly from the client contract

## Problem

At `ab2889452`, `workflow-ops/runs/run-show.ts:metadataFromDetail` reconstructs
`WorkflowRunMetadata` from `WorkflowRunDetail`, inventing empty paths and per-step
timestamps before invoking the runtime decoder. The local client performs the
opposite metadata-to-detail conversion. This is duplicated representation work;
specific visible regressions still need reproduction, not assumption.

## Outcome

Render the normal `workflow show` summary from truthful client data through the
existing CLI presentation owner. Remove the synthetic reverse conversion and
branches/helpers that exist only to satisfy that shape. Retain the runtime
metadata decoder for its actual storage boundary. If a displayed value is absent,
represent absence honestly or obtain it from its real owner, never invent it.

## Acceptance

Local and daemon-backed output preserve delivery/continuation state, warnings,
unknown costs, causal linkage and scoped lookup. Preserve `--step`, `--payload`,
`--chain`, redaction and evidence authority. Use representative existing command
output cases and owning boundary tests; remove obsolete conversion assertions.
Report production/test deltas and the deleted ownership round-trip. Do not add
a second presentation schema, runtime API, snapshot catalog or compatibility shim.
