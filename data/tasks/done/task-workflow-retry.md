---
id: task-workflow-retry
title: Add workflow run retry from last failed step
status: done
priority: p2
area: workflow
summary: Failed workflow runs cannot be retried without re-running from scratch. A retry command that resumes from the first failed step (reusing prior step outputs) would reduce cost and cycle time when transient failures occur.
created_at: 2026-03-25
updated_at: 2026-03-25
---

## Problem

When a workflow run fails mid-way (e.g., a flaky test, a network error, or an agent timeout), the only option today is to wait for the next scheduled trigger and run the whole workflow again. All prior step outputs are discarded even though they are stored in the run directory. This wastes time and cost.

## Desired Outcome

- `kota workflow retry <runId>` re-executes the failed run starting from the first step that did not complete successfully.
- Step outputs from already-successful steps are loaded from the original run's metadata and injected as if those steps just ran.
- The retry creates a new run entry (new runId) linked to the original, rather than mutating the failed run.
- `kota workflow show` indicates which runs are retries and links to their origin run.

## Constraints

- Do not mutate the original run's metadata; always create a new run record for the retry.
- Only retry from a terminal failed step — do not allow retrying a currently-running run.
- The step re-execution semantics must match normal execution (same timeout, error handling, continueOnFailure rules).
- Scope to the CLI for now; web UI integration is a follow-up.

## Done When

- `kota workflow retry <runId>` is accepted by the CLI.
- Successful steps from the original run are replayed without re-execution.
- Failed and subsequent steps are re-executed normally.
- The new run is stored and visible in `kota workflow list`.
- Tests cover retry from a mid-run failure and retry of a fully-failed first step.
