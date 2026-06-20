# Acceptance Evidence

## Raw Churn No Longer Queues Scope-Improver

Static trigger query:

```text
$ rg "watch:|task\.changed|workflow\.build\.committed|scopeImprovementEvidenceReady|files\.changed" src/modules/autonomy/workflows/scope-improver/triggers.ts
  scopeImprovementEvidenceReady,
  { event: scopeImprovementEvidenceReady.name },
```

`src/modules/autonomy/workflows/scope-improver/workflow.test.ts` now validates
registered triggers contain `autonomy.scope-improvement.evidence-ready` and do
not contain `files.changed`, `task.changed`, or `workflow.build.committed`.
`src/modules/autonomy/workflows/scope-improver/evidence-gate.test.ts` asserts
`file-churn` and `task-churn` have zero weight.

## Evidence-Ready Payload Shape

`src/modules/autonomy/workflows/scope-improver/evidence-gate.test.ts` builds a
local payload with these nonzero source kinds:

```text
failed-run
dead-letter
recovery
repeated-warning
oversized-source
```

The fixture asserts every source has positive weight, `evidenceIds` match the
source ids, `reason` includes `totalWeight=`, and `dedupeSignature` uses the
`scope-evidence:<hash>` form. The module event declaration in
`src/modules/autonomy/workflows/scope-improver/events.ts` defines those fields
and includes an example payload.

## Duplicate Signature Replay

`src/modules/autonomy/workflows/dispatcher/workflow.test.ts` runs dispatcher
twice against the same failed-run evidence. The first run emits
`autonomy.scope-improvement.evidence-ready`; the second emits none and reports
`duplicate scope-improvement evidence signature`.
