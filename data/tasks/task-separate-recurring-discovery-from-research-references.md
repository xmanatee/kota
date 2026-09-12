---
status: open
priority: p1
depends_on: [task-continue-idle-discovery-through-unreviewed-opportunities]
---
# Make the watchlist discover developments, not reread settled references

## Evidence

At `ab2889452`, `data/watchlist.yaml` contains 119 entries, including 51 GitHub
repositories and 30 individual arXiv papers. Explorer `ursnye` on September 12
fetched 118 sources; all 30 papers were unchanged. `source-evidence.ts` applies
the same 30-minute eligibility to every entry. Static references do not dominate
the count, but adding them alongside tasks leaves settled research in recurring
monitoring. The predecessor owns cached evidence and opportunity-scoped admission;
do not reimplement that work.

## Outcome

Make the existing watchlist a small set of useful evolving sources with clear
reasons to revisit. Review current entries: keep legitimate recurring sources,
replace one-off links with a relevant project/release/research-series surface
where justified, and retire settled references from recurring fetches. Preserve
owner captures and citations in their existing task/decision records. Inaccessible
is an access state, not a reason to erase a source or invent its contents.

Use the existing fetch/observation owner for sensible source refresh and unchanged
content handling. Prefer existing feed/release metadata and simple source policy
to new scheduling machinery. Do not require every reference to become a monitor,
copy articles into source files, or add a task merely because an article exists.
Update Explorer's current instructions and publication behavior where they cause
the confusion; replace those instructions instead of appending another checklist.

## Acceptance

A changed relevant source produces one attributable, deduplicated decision or
useful task batch; unchanged or settled material does not repeatedly consume
agent review. References remain discoverable without recurring fetches. A
temporarily inaccessible source can recover, and changed owner/task context can
reuse the predecessor's retained readable evidence without refetching everything.
Verify these decisions at existing owners with representative inputs and one
bounded source observation, not a new crawler, copied source corpus, or time quota.
