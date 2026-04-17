---
id: task-snapshot-watchlist-content-so-explorer-can-detect-
title: Snapshot watchlist content so explorer can detect meaningful updates
status: done
priority: p2
area: autonomy
summary: Record per-URL content fingerprint + short summary so explorer can tell changed entries from unchanged ones across runs
created_at: 2026-04-17T13:13:58.737Z
updated_at: 2026-04-17T23:25:47.772Z
---

## Problem

`data/watchlist.yaml` lists external resources the explorer consults on every run. Today explorer re-fetches each entry without any memory of what it already saw, so there is no way to tell whether a URL's content has meaningfully changed since the last visit. Entries that rarely update still burn exploration effort, while genuinely new external signal sits unamplified next to stale repeat reads. This also makes it hard for the owner to audit whether the watchlist is producing value — there is no trail of "this entry last changed on date X, summary was Y."

## Desired Outcome

- Each watchlist entry carries a durable fingerprint (content hash or equivalent) plus a short last-seen summary after it has been fetched at least once.
- Explorer detects changed vs. unchanged entries across runs and prioritizes attention accordingly, without removing operator-authored metadata from the YAML.
- Inaccessible entries remain honestly recorded (as today) and do not get treated as "changed" just because the fetch failed.
- Operators can scan the watchlist and tell at a glance which entries are active, stale, or inaccessible, without reading run artifacts.

## Constraints

- `data/watchlist.yaml` must stay human-editable. Machine-maintained fields should be clearly scoped under per-entry keys, not mixed with operator fields.
- Do not introduce a separate fingerprint store (sqlite, sidecar JSON) when the YAML itself can hold the state. Keeping one file as the source of truth is a KOTA convention.
- Change detection must be robust to trivial whitespace/timestamp churn on common sites; a raw byte hash alone is too brittle. Use a normalized content view (extracted text or structured summary) for comparison.
- Must not leak agent-facing cost signals into the autonomy loop — storing numeric scores is fine; surfacing "this is expensive to refetch, skip it" to autonomy agents is not.

## Done When

- The explorer run surfaces (in its prompt or state output) which watchlist entries are new-or-changed and which are unchanged since the last successful fetch.
- `data/watchlist.yaml` entries pick up a fingerprint field and a concise summary field when the explorer has successfully inspected them.
- Inaccessible entries still get `status: inaccessible` and are not mis-classified as changed.
- A test covers the change-detection classifier (changed / unchanged / inaccessible) against representative inputs.

