---
status: open
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