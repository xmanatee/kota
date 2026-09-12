---
status: done
---
# Add algorithmic resource-budget canaries to the eval harness

## Outcome

The shipped `builder-algorithmic-resource-budget-canary` fixture starts with
a quadratic inversion counter that passes small examples but fails generated
large cases. Its scorer uses opaque values and counted comparisons, emits
`resource-budget-result.json`, and exposes the budget ratio through the existing
objective-metric path. The manifest requires the implementation outcome, task
archival and bounded changed paths; scorer self-tests stay in owner verification.

Under the September 13 owner authorization, implemented and locally validated
fixture/scorer behavior completes this task. A model need not solve the fixture
before it can ship. Live algorithm-selection quality remains for explicit eval
selection or existing cadence, not a duplicate qualification task.

## Verification And Limits

On September 13, `pnpm kota eval list` loaded the fixture.
`pnpm test:owner src/modules/eval-harness/scorer-self-tests.test.ts -t algorithmic`
passed the selected case, rejecting sample-only, comparison-proxy, hardcoded
answer and case-metadata shortcuts; six unrelated cases were deselected.
A direct call to the shipped evaluator confirmed initial visible examples pass,
initial large canaries fail, and the trusted golden implementation passes with
`maxOperationRatio: 0.549512`. These were local scorer checks, not agent runs.

No live nested builder or Docker execution ran in this audit. Retained
September 12 host inspections reported unset `KOTA_EVAL_CONTAINED_PROFILES`;
image, egress and adapter authentication still need qualification before a
live run. Preserve immutable verifier isolation and resource limits. The
deterministic comparison proxy is not measured live CPU/memory use or a
model-quality result.

## Intent And Provenance

Explorer used ProjDevBench as the research signal:
https://github.com/zsworld6/projdevbench. The distinct failure is small-example
success with unsustainable algorithmic growth, not another empirical-score
fixture or online-judge integration. This is synthetic, not a claimed historical
KOTA regression. Git and retained runs preserve earlier attempts.
