---
id: task-workflow-run-downstream-query
title: Add downstream causality query to find runs triggered by a given run
status: done
priority: p3
area: observability
summary: The causedBy field tracks which upstream run triggered each run. The reverse direction — "which runs did this run trigger?" — is not queryable. Adding a downstream filter to the run list API and CLI completes the causality chain navigation.
created_at: 2026-04-01T07:53:00Z
updated_at: 2026-04-01T09:21:00Z
---

## Problem

`GET /workflow/runs/:id` and `kota workflow show` display `causedBy` (the upstream run that triggered this one). But there is no way to go the other direction: given a builder run, find all runs it spawned (e.g., an improver run triggered by the builder completing). Operators tracing autonomous loop behavior must manually cross-reference run IDs.

The `causedBy` data is stored in every run record. A downstream query is a scan over run records filtering by `causedBy.runId == target`, which is affordable at current run volumes.

## Desired Outcome

- `GET /workflow/runs` accepts an optional `causedByRunId` query parameter that returns only runs whose `causedBy.runId` matches.
- `kota workflow runs --caused-by <run-id>` filters by this parameter.
- `kota workflow show <run-id>` prints a "Triggered runs:" section listing downstream run IDs and workflows when any exist.
- The web UI run detail "triggered by" link (already present for upstream) gains a complementary "triggered runs" list when downstream runs exist.

## Constraints

- Downstream query scans stored run records; no new index is required at this run volume.
- Daemon API change follows the existing pattern for `GET /workflow/runs` query parameters; document the new parameter in `docs/DAEMON-API.md`.
- Web UI downstream list is a stretch goal; the API and CLI are the core requirement.
- Only one hop downstream (direct children), not recursive chain traversal.

## Done When

- `GET /workflow/runs?causedByRunId=<id>` returns the correct downstream runs.
- `kota workflow runs --caused-by <run-id>` filters correctly.
- `kota workflow show <run-id>` lists triggered downstream runs when present.
- New query parameter is documented in `docs/DAEMON-API.md`.
- Unit test covers the downstream filter with a fixture set of run records.
