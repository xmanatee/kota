---
id: task-resolve-nova-launch-notification-copy
title: Resolve the Nova launch notification copy
status: ready
priority: p2
area: eval-harness
summary: Use the deterministic user simulator to clarify the missing Nova launch notification requirement, then patch the copy formatter and write dialogue evidence.
created_at: 2026-06-20T00:00:00.000Z
updated_at: 2026-06-20T00:00:00.000Z
---

## Problem

`src/notification-copy.mjs` still emits stale launch notification copy. The
initial request deliberately omits the material channel requirement. The answer
is available only through the fixture's deterministic simulator; do not guess
from the current implementation.

## Desired Outcome

Ask the simulator one concise, relevant clarifying question before patching:

```sh
node scripts/user-simulator.mjs ask "<your question>"
```

Then update `src/notification-copy.mjs` so the launch notification label uses
the requirement facts returned by the simulator. Finish by running:

```sh
node scripts/check-dialogue.mjs
```

The checker writes `dialogue-result.json` with the transcript, elicited facts,
final decision, verification command, and implementation evidence.

## Constraints

- Keep the simulator and checker deterministic and offline.
- Do not edit `scripts/user-simulator.mjs`, `scripts/check-dialogue.mjs`,
  `package.json`, fixture metadata, or generated evaluator files.
- Ask only about the missing Nova launch notification requirement. Irrelevant,
  repeated, or excessive questions fail the fixture.
- Do not hardcode the Nova example output. The implementation must use product
  and time inputs while reflecting the simulator's channel and label pattern.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- The simulator transcript contains one bounded relevant clarification turn and
  the SMS launch notification facts.
- `src/notification-copy.mjs` formats SMS launch labels from product and UTC
  time inputs using the simulator-provided label pattern.
- `node scripts/check-dialogue.mjs` exits successfully and writes
  `dialogue-result.json`.
- `dialogue-result.json` records the bounded transcript, elicited facts, final
  decision, verification command, implementation evidence, and quality score.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- The simulator transcript under `.kota/dialogue-simulator/transcript.json`.
- Command output from `node scripts/check-dialogue.mjs`.
- The generated `dialogue-result.json` artifact.
- The fixture run artifact records the `dialogue_quality_score` objective
  metric.

## Source / Intent

Eval-harness fixture seed for measuring dialogue-driven coding behavior. The
builder should clarify the missing requirement, use the answer, and leave
machine-readable evidence that distinguishes useful dialogue from lucky
autonomous patching, question loops, or ignored answers.

## Initiative

Outcome-grade autonomy evaluation: KOTA should grade whether builders can ask a
useful clarifying question in an underspecified coding task before making the
right patch.
