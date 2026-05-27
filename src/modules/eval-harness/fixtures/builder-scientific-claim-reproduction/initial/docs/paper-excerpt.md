# Excerpt: LX-12 Biomass Trial

The paper reports a small greenhouse trial of additive LX-12. Claim 2 states:

> In the mature week-6 greenhouse-A cohort, LX-12 increased median dry biomass
> by at least 40 percent relative to untreated controls.

The methods section gives the analysis details in prose rather than code. Use
only rows where `cohort=mature`, `phase=week6`, `site=greenhouse-a`,
`include_in_claim=yes`, and `quality_flag=ok`. Compare `treatment=lx12` with
`treatment=control`. The primary endpoint is median `dry_biomass_g`, not the
mean. Uplift is `(median_lx12 - median_control) / median_control * 100`.

Screening rows, drought-flagged rows, juvenile rows, early endpoints, and
greenhouse-B rows are visible in the data file but were not part of Claim 2.
