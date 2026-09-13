---
status: done
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

## Completion

Workflow show now consumes WorkflowRunDetail directly through the existing
rendering owner. Removed detail-to-metadata reconstruction, synthetic paths and
step timestamps, unreachable step output/repair/harness branches, and the local
metadata reader wrapper. The runtime storage decoder remains unchanged. Local
delivery is projected through its existing evidence owner, with sensitive reason
and blocker text redacted; absent client delivery displays as unavailable.

A before/after command probe against identical client detail reproduced the
missing-tags regression and verified the restored tags. An isolated operator
transcript exercised payload redaction, unknown costs, full step output and chain
rendering. Five command cases replace copied display logic and obsolete helper
assertions. Selected command/client/authority tests passed (90), as did the
storage metadata boundary suite (50) and pnpm check:fast. Evidence is in this
builder run's workflow-show-transcript.txt, workflow-show-comparison.txt and
check-fast.log. Daemon transport was controlled; no production daemon was changed.

Production TypeScript delta: +60/-188 lines (net -128). Test delta: +170/-302
lines (net -132). The deleted round-trip was stored metadata → client detail →
synthetic metadata → rendering; rendering now follows client detail directly.
