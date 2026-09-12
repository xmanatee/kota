---
status: done
---
# Preserve watchlist values across YAML updates

## Current Contract

The September 12 owner waiver makes a subsequent production explorer capture
non-gating. Validate the editor-first YAML boundary and explorer review suppression
through available supported context, reusing the real-file evidence below where
still applicable. Repair any remaining semantic churn; do not restore the retired
serializer or treat a fresh artifact path as proof. Historical live gaps remain
unobserved, not failures or a claim of deployed success.

This contract supersedes historical blocking and operational-capture requirements.


## Problem

explorer/watchlist.ts stripQuotes removes delimiters without decoding YAML escapes;
quoteIfNeeded escapes the resulting backslashes again. Consequently an unrelated
snapshot update changes untouched values on every read/write cycle. Commits
6408cca46, 56bf778d1, 203e8a6be and 4ef8db519 grow backslashes in the Anthropic
research summary. On 4ef8db519, parseWatchlist(serializeWatchlist(parsed)) is not
deep-equal to parsed. This corrupts evidence and creates false novelty.

## Desired Outcome

Keep watchlist authoring editor-first, with the maintained YAML parser and a
small typed validation boundary before publication. Do not recreate a JSON
editing envelope or automatic read/modify/write pipeline for ordinary file
edits. Preserve operator fields, dates, source identity, comments/header, and
untouched snapshots. Invalid input must be diagnosed, not silently lost. Source
fingerprints and review admission remain runtime-owned evidence, not claims in
an agent-authored update request. Repair demonstrated corruption only from
attributable Git or source evidence, never by globally unescaping owner strings.

## How We Will Know

Retain the historical round-trip failure as evidence of the removed writer's
defect. Prove direct single-source edits preserve semantic values of all other
entries and that completed-change validation accepts quotes, literal backslashes,
multiline text and dates while rejecting malformed input. Use proportionate
existing tests and one real-file check,
not field-by-field configuration assertions. Exercise the supported explorer path
without unrelated escaping churn; unchanged evidence must not trigger review.

## Retained implementation and evidence

The structured YAML boundary and evidence-backed Anthropic snapshot repair are
retained. Ordinary edits now belong to the editor, not a document-preserving
mutation consumer. This removes the repeated automatic serialization that caused
the defect; it does not establish live acceptance. The prior done disposition
was premature.

The historical real-file probe preserves all 116 entries through five round trips
and the other 115 entries through a single-source update. It uses a freshly
fetched GitHub README replayed through a controlled web tool port. Its initial
review admission and repeated review suppression are production-owner checks,
not a live explorer workflow observation.

During repair, the accessible workspace run archive contained no explorer runs.
The public workflow trial path was inspected but not executed: its source-tree
copy includes explicitly denied environment files. No scoped KOTA execution or
export connector is available in this repair session. This limitation concerns
this sandbox only and makes no claim about host credentials or capabilities.

The existing probe, before/after files, source capture, historical reproduction,
and snapshot attribution are copied to
`.kota/runs/watchlist-yaml-repair-evidence/` for workspace-local review; originals
remain in the builder run evidence. `live-acceptance-status.json` records the
collection assessment. A live explorer observation was not obtained by that
attempt; the current contract assigns it to operational follow-up.


## Completion under the September 12 contract

The retained parser and editor-first validation satisfy the current contract;
no additional production-code or watchlist-content change was needed. The live
explorer capture remains unobserved operational follow-up under the owner waiver.

At revision `3396727738494f225142b4fc2a9523a79dd8a3cd`, the current real watchlist
contains 118 entries. A direct single-source snapshot edit in an isolated copy
preserved the semantic values of the other 117 entries, all operator fields on
the edited entry, and the surrounding YAML bytes. Five repeated reads preserved
values and bytes. The explorer's declared publication validator accepted escaped
quotes, literal backslashes, multiline text and date strings without rewriting;
it rejected a numeric snapshot date with a field-specific diagnostic and left
the invalid input intact.

The production source-evidence owner and workflow review predicate admitted an
initial observation, suppressed unchanged evidence after the YAML edit,
preserved its fingerprint on failed access, and admitted changed source content.
This used a controlled web-tool replay of the checked-in OpenClaw snapshot with
fresh cache records for other entries. It is deterministic boundary evidence,
not a live source fetch, full agent workflow run, or deployed-success claim.

The earlier `.kota/runs/watchlist-yaml-repair-evidence/` directory was absent in
this workspace. Historical evidence was therefore reproduced from Git commit
`4ef8db5195e5913315d21bfaf652e29f4485a462`: its old parser/serializer changes the
Anthropic research entry on a single round trip. The attributed snapshot repair
diff from `624eb851d` is retained alongside that reproduction; no global string
unescaping was performed.

Evidence is in builder run `2026-09-12T06-41-05-779Z-builder-rwi8w4`, under
`agent/watchlist-probe.mjs` and `agent/watchlist-evidence/`: `result.json`, real
before/after YAML, multiline YAML, invalid-input diagnostic, controlled source
content, observed source outputs, historical source/before/after YAML, and the
attributed repair diff.

Validation: `pnpm check:fast` passed. The existing watchlist and source-evidence
owner suites passed 21 tests; two validation-command tests could not start
because the sandbox denied `/bin/ps` in the shared process wrapper. The direct
probe executed the identical declared validator successfully and checked both
acceptance and rejection without changing the wrapper. Task validation was
rerun after this archive transition.
