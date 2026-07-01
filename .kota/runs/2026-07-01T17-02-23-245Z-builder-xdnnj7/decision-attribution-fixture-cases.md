# Decision Attribution Fixture Cases

The focused fixture in `src/modules/autonomy/report/decision-attribution.test.ts`
and the sample project in this run directory cover these cases:

1. Owner-planned / KOTA-executed Product work:
   `run-owner-product` and `2026-06-30T10-00-00-000Z-builder-hard`.
2. KOTA-planned work without visible owner/domain context:
   `run-kota-planned` and `2026-06-30T11-00-00-000Z-builder-kota`.
3. Mixed planning/execution from owner correction during a builder run:
   `run-mixed`.
4. Unknown planning and execution:
   `run-unknown` and `2026-06-30T13-00-00-000Z-manual-unknown`.
5. Hard success with evidence:
   accepted critic verdict, committed task completion, passing validation, and
   rendered Product evidence in `run-owner-product`.
6. Claimed success with weak evidence:
   Product work with implementation tests but no rendered evidence in
   `run-weak-product` and `2026-06-30T12-00-00-000Z-builder-weak`.

The report transcript also includes a trouble/retry run:
`2026-06-30T14-00-00-000Z-builder-trouble`.
