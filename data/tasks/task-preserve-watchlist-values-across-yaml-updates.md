---
status: blocked
priority: p1
---
# Preserve watchlist values across YAML updates

## Problem

explorer/watchlist.ts stripQuotes removes delimiters without decoding YAML escapes;
quoteIfNeeded escapes the resulting backslashes again. Consequently an unrelated
snapshot update changes untouched values on every read/write cycle. Commits
6408cca46, 56bf778d1, 203e8a6be and 4ef8db519 grow backslashes in the Anthropic
research summary. On 4ef8db519, parseWatchlist(serializeWatchlist(parsed)) is not
deep-equal to parsed. This corrupts evidence and creates false novelty.

## Desired Outcome

Use a maintained structured YAML parser/serializer with a small typed boundary
instead of the bespoke line/quote parser. Check existing workspace dependencies
and choose the smallest conventional owner; declare a dependency properly if
needed. Preserve operator fields, dates, source identity, comments/header where
supported, and untouched snapshots. Invalid input must be diagnosed, not silently
lost. Do not introduce a second format, compatibility parser or general migration
framework. Repair the demonstrated corrupted snapshot from attributable Git or
source evidence, never by globally unescaping owner-authored strings.

## How We Will Know

Reproduce the real watchlist round-trip failure, then prove repeated load/save
and single-source updates preserve semantic values of all other entries. Include
quotes, literal backslashes, multiline text, dates and malformed input at the
serialization owner. Use proportionate existing tests and one real-file check,
not field-by-field configuration assertions. Observe a live explorer update
without unrelated escaping churn; unchanged evidence must not trigger review.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Runtime-owned candidate explorer execution with live source observations, unchanged unrelated YAML values, and repeat-review suppression; equivalent attributable exports are accepted.

Runtime-owned live explorer evidence for the candidate YAML implementation. The
required live update and subsequent unchanged-evidence review skip have not been
observed. Resume when an authorized isolated execution or attributable export
provides the candidate code/run identity, live source observations, before/after
watchlist values showing no unrelated escaping churn, and the later review
decision on unchanged evidence. No new owner permission or prescribed capture
directory is required; equivalent accessible evidence is sufficient.

## Retained implementation and evidence

The structured YAML boundary, document-preserving update consumer, focused
regressions, and evidence-backed Anthropic snapshot repair are retained. These
changes address serialization safely; they do not establish live acceptance.
The prior done disposition was premature.

The existing real-file probe preserves all 116 entries through five round trips
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
collection assessment. The original acceptance criteria above remain unmet only
for the live explorer observation.