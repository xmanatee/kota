---
status: done
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


## Curation and reference preservation

The recurring list now has 59 sources rather than 119. Individual papers and
settled benchmark-methodology links remain in their owning task records. Historical
SWE-agent, Letta V1, AutoGen and Reflexion pointers leave monitoring; their active
successors remain where available. Core MCP reference pages now lead to one
stable-release surface; independently evolving extensions retain separate monitors.
All six inaccessible entries remain listed, with their prior snapshots intact.
No owner capture or another task contract was changed.

These previously watchlist-only citations remain discoverable here. Their retained
snapshots establish the historical assessment, not a fresh read of those sources:

- https://github.com/SWE-agent/SWE-agent — historical research runtime; the observed
  successor path is mini-SWE-agent, which remains monitored.
- https://github.com/letta-ai/letta — the observed README points active development
  to letta-code; the old repository retained V1 history.
- https://github.com/microsoft/autogen — observed maintenance-mode pointer to the
  monitored Microsoft Agent Framework.
- https://github.com/noahshinn/reflexion — settled verbal-self-reflection reference;
  existing local rejection remains the decision, not a recurring review request.
- https://arxiv.org/abs/2606.24429 — Detecting AI Coding Agents in Open Source;
  prior observation reinforced existing run/harness attribution and quality reports.
  Revisit for a concrete local attribution failure, not elapsed time.


## Outcome evidence

Explorer's existing observation owner now refreshes sources daily by default or
weekly for slower research and specification surfaces. A source's notes contribute
its owner intent to review identity; snapshots, access status, and elapsed time do
not manufacture new reviews. The predecessor's retained readable evidence and
runtime finalizer remain the owners of reuse and published review deduplication.
The watchlist schema admits the policy at both repair and publication validation.
Explorer's prompt and scoped guidance now distinguish recurring development from
one-off citations, replacing the instruction to add any valuable resource.

A bounded authorized GitHub observation of
https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/releases/latest
identified stable release `2026-07-28` and its linked specification changelog.
The resulting decision is the single stable-release monitor in this changeset,
not another protocol implementation task. The response and assessment remain in
this run's `bounded-source.json` and `discovery-observation.json`. Replaying those
recorded bytes through the observation owner admitted the first assessment and
skipped the settled assessment without another fetch. This is recorded-source
boundary proof, not a live autonomous-agent quality evaluation.

`pnpm check:fast` passed production/test typechecking, lint, task validation,
client binding checks and module admission. The focused Explorer run passed 25
cases covering source changes, unchanged rechecks, daily/weekly cadence,
inaccessible recovery, retired citations, changed task/owner intent, retained-byte
integrity and durable observation publication. Two existing repair/publication
command-runner cases failed before their validators launched because sandbox
process supervision could not run `/bin/ps` (`EPERM`). The same watchlist validator
was executed directly: it accepted weekly refresh, rejected an invalid cadence,
and left the invalid file untouched. The actual curated watchlist and task queue
also passed direct validation. `explorer-tests.log`, `check-fast.log`, and
`verify-discovery.mjs` retain the commands, limitations and scoped replacement proof.
A curation comparison verified all six inaccessible entries and every retained
snapshot, added date and canonical alias against the admitted repository version.
