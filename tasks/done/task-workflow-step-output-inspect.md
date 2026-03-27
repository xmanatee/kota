---
id: task-workflow-step-output-inspect
title: Add step output inspection to workflow CLI
status: done
priority: p3
area: workflow
summary: kota workflow show displays step status and duration but not step output payloads. Adding a --step flag to print the full JSON output of a specific step would make it much easier to debug what a code or tool step returned during a run.
created_at: 2026-03-20
updated_at: 2026-03-27T04:47:00Z
---

## Problem

`kota workflow show <runId>` renders step statuses and timing, but the output payload for each step is not accessible from the CLI. To inspect what a code step returned, users must manually navigate the `.kota/runs/` directory and read the run's JSON file. This is tedious and error-prone.

## Desired Outcome

- `kota workflow show <runId> --step <stepId>` prints the full output of that step as formatted JSON.
- If the step failed, the error message is printed instead.
- The flag can be combined with the existing run display or used standalone.

## Constraints

- Read step output directly from the run metadata file — no new storage needed.
- Keep the change narrow to `workflow-cli/run-show.ts` and the run-store helpers.
- Do not change the default `kota workflow show` output format.

## Done When

- `--step <stepId>` flag is accepted by `kota workflow show`.
- Prints step output JSON (or error) to stdout.
- Works for all step types that produce output (code, tool, agent).
- Tests cover the flag for a step with output and a step with an error.
