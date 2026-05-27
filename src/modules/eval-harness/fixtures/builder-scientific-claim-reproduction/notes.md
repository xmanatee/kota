# builder-scientific-claim-reproduction

## Source

No source run id. This is a live-builder smoke fixture for the AutoMat-shaped
claim-reproduction gap: the builder must recover a compact computational
procedure from paper-like prose, run local data, and make an explicit
support/refute decision through artifacts rather than final prose.

## Shape

The fixture seeds a small biomass trial. `docs/paper-excerpt.md` states the
claim and the filtering details, `data/claims/lx12-biomass.csv` contains both
claim rows and tempting excluded rows, and `scripts/analyze-claim.mjs` starts
as a deliberately wrong mean-over-all-rows analysis.

The task asks the builder to implement the median filtered analysis and write
`claim-result.json` plus `claim-holdout-result.json`. Host-side scoring uses a
typed harness predicate that parses those fixed artifacts and never executes
mutable fixture scripts after the workflow run. The holdout data set catches
main-data-only shortcuts. The `median_uplift_pct` objective metric is reported
from `claim-result.json`; predicates still own pass/fail.

This stays out of `pnpm test` because the fixture invokes a live builder agent.
The co-located unit test only verifies fixture wiring and shortcut rejection in
a temporary copy of the initial tree.
