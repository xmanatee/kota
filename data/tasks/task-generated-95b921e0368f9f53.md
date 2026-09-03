---
status: blocked
priority: p1
---
# Repair repeated evaluator-calibration monitor execution dead letters

## Problem

Export and inspect the seven linked dead letters, preserve their exact failure reason and failing step, and reproduce the shared failure through a completed-builder trigger. Repair the evaluator-calibration-monitor aggregation or runtime boundary so valid triggers reach a terminal outcome without weakening fail-closed handling of authority-critical run metadata. After verification, redrive or dismiss every cited dead letter with durable rationale.

## Desired Outcome

Resolve autonomy issue autonomy-issue-65f82f71f370a705956a at semantic revision 1.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## Blocked on

```
kind: operator-capture
path: .kota/runs/evaluator-calibration-monitor-dlq-capture/diagnostics.json
description: operator-provided exports from `kota workflow dlq export <id>` for all seven cited ids, including each exact failure reason, failed run, and failing step, plus authenticated access to redrive or dismiss those canonical items after same-shape verification
```

An operator-controlled canonical diagnostic capture is required for the seven
cited dead letters. This builder sandbox cannot read the canonical
`.kota/dead-letter-queue/items.json`, enter the canonical scope as a process
working directory, or authenticate to its daemon control API. Provide exports
from `kota workflow dlq export <id>` for all seven cited ids, including each
item's exact failure reason, failed run, and failing step, plus a mutation path
that can redrive or dismiss the canonical items after verification. The task
must not infer the shared execution fingerprint from the issue summary.

## How We Will Know

A focused real-failure regression derived from a cited dead letter reproduces the shared failure, then proves a completed-builder trigger runs the monitor to success, writes the calibration observation, emits only the decision-appropriate events, and creates no workflow-dispatch dead letter. Existing fail-closed metadata-authority behavior remains covered, and all seven linked dead letters receive terminal dispositions.

## Context

Issue reviewer disposition:     The issue records two observations within 23 seconds, growing from five to seven evaluator-calibration-monitor dead letters with the same execution fingerprint; evidence includes dlq-2297db84-7eab-44c6-b75c-e2509dc8b2cb through dlq-f8a37ad1-369a-4b6f-8662-2ed29fc79954. The monitor's current path performs durable-authority run-metadata aggregation before writing its observation and emissions. The issue links no task, and the active queue has no evaluator-calibration-monitor execution repair. This repeated local-code failure warrants one builder-owned repair without an owner decision.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-2297db84-7eab-44c6-b75c-e2509dc8b2cb
- dead-letter: .kota/dead-letter-queue/items.json#dlq-a4100955-af0f-472e-8e17-8272678ed62e
- dead-letter: .kota/dead-letter-queue/items.json#dlq-c61ee01e-d26b-4b08-b332-d5c0a0451ca7
- dead-letter: .kota/dead-letter-queue/items.json#dlq-ca6a7623-de63-47b2-9a30-b8eee046cb33
- dead-letter: .kota/dead-letter-queue/items.json#dlq-d4498bb5-31a8-463b-9650-4088d86c565c
- dead-letter: .kota/dead-letter-queue/items.json#dlq-f28d85ba-ddfd-4973-a2bf-4ec47bef233c
- dead-letter: .kota/dead-letter-queue/items.json#dlq-f8a37ad1-369a-4b6f-8662-2ed29fc79954
