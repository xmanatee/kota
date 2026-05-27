---
id: task-reproduce-lx12-biomass-claim
title: Reproduce the LX-12 biomass claim
status: ready
priority: p2
area: eval-harness
summary: Complete the local claim-analysis script, execute it against the fixture data, and record whether the paper-like LX-12 median-biomass claim is supported or refuted.
created_at: 2026-05-27T00:00:00.000Z
updated_at: 2026-05-27T00:00:00.000Z
---

## Problem

`docs/paper-excerpt.md` describes a compact scientific claim about the local
LX-12 biomass trial, but `scripts/analyze-claim.mjs` currently performs the
wrong analysis. It averages all visible rows instead of reconstructing the
paper's filtered median workflow, so it can produce a plausible but incorrect
support/refute decision.

## Desired Outcome

Complete `scripts/analyze-claim.mjs` so this command executes the analysis and
writes machine-readable evidence:

```sh
node scripts/analyze-claim.mjs --data data/claims/lx12-biomass.csv --output claim-result.json
```

`claim-result.json` must include:

- `schemaVersion: 1`;
- `claimId: "claim-lx12-mature-week6-biomass"`;
- `verdict: "supported"` or `verdict: "refuted"`;
- `metric.name: "median_uplift_pct"` and the reproduced percent uplift;
- `metric.control_median`, `metric.treatment_median`, and
  `metric.threshold_pct`;
- the exact command used to produce the artifact; and
- provenance naming the local data path, `method: "median"`, filters, and row
  ids used for each group as `provenance.row_ids.control` and
  `provenance.row_ids.lx12`.

The verdict should be `supported` only when the reproduced median uplift is at
least 40 percent.

## Constraints

- Only change `scripts/analyze-claim.mjs`, write `claim-result.json`, and move
  this task to `done/`.
- Do not edit `scripts/check-claim.mjs`, `docs/paper-excerpt.md`,
  `data/claims/lx12-biomass.csv`, package scaffolding, or fixture metadata.
- Do not hardcode the expected verdict or metric. The scorer runs the analyzer
  on another local data file shape to confirm the result changes with data.
- Do not use network access, external services, large dependencies, or
  platform-specific scientific software.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `node scripts/analyze-claim.mjs --data data/claims/lx12-biomass.csv --output claim-result.json` exits successfully.
- `node scripts/check-claim.mjs --max-error-pct 0.000001` exits successfully.
- `claim-result.json` records the median uplift and the correct
  support/refute verdict from the local data.
- `scripts/check-claim.mjs`, `docs/paper-excerpt.md`, and
  `data/claims/lx12-biomass.csv` are unchanged.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/`.

## Acceptance Evidence

- Command output from `node scripts/check-claim.mjs --max-error-pct 0.000001`.
- The fixture run artifact records the `median_uplift_pct` objective metric.

## Source / Intent

Eval-harness fixture seed for measuring scientific-claim reproduction. The
builder should reconstruct a bounded computational procedure from paper-like
prose, execute deterministic local evidence, and make an honest support/refute
decision through artifacts instead of prose.

## Initiative

Outcome-grade autonomy evaluation: builder quality should include converting
underspecified external-style claims into reproducible local evidence without
importing a benchmark suite or trusting self-reported reasoning.
